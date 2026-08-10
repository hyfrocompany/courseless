# screen-shot.ps1 — capture the composited desktop, or crop a capture we already took.
#
# Used by PointService for the vision fallback. Two reasons this is a PowerShell script and not
# Electron's desktopCapturer: CopyFromScreen gives PHYSICAL pixels (the same coordinate space as
# UIA rects), and it captures the REAL composited desktop including always-on-top overlays that a
# renderer-side capture cannot see.
#
#   -Mode capture -Path out.png                                  whole virtual desktop
#   -Mode capture -Path out.png -X n -Y n -W n -H n               only that screen rect
#   -Mode crop -In full.png -Path crop.png -X n -Y n -W n -H n    crop of an EXISTING capture
#   -Mode burst -Path prefix -Count 5 -DelayMs 120                prefix-0.png … (animation proof)
#
# capture/burst take an optional clip rect in SCREEN pixels. Capturing only the region you care
# about is the privacy-preserving default for anything that gets written somewhere durable.
#
# Prints one line of compact JSON: { ok, path|paths, w, h, x, y, monitors, ms, error? }
#
# `monitors` is how many physical screens went into the capture. It exists because "is this
# screenshot more than one monitor side by side?" cannot be answered from the width: a 3440px
# ultrawide is one screen. PointService puts that sentence in the vision prompt, and only when
# this says so.
#
# Nothing is retained: PointService deletes every file it asks for.

[CmdletBinding()]
param(
  [string]$Mode = 'capture',
  [string]$Path = '',
  [string]$In = '',
  [int]$X = 0,
  [int]$Y = 0,
  [int]$W = 0,
  [int]$H = 0,
  [int]$Count = 3,
  [int]$DelayMs = 120,
  # Layered (transparent, always-on-top) windows are NOT in a plain BitBlt of the screen. That is
  # exactly right for the vision fallback -- the engine must never see Courseless's own ghost
  # cursor in the screenshot it is asked to read -- and exactly wrong for a verification capture
  # that is trying to prove the arrow reached the screen.
  [switch]$IncludeLayered
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$sw = [System.Diagnostics.Stopwatch]::StartNew()

function Emit($obj) {
  $obj.ms = [int]$sw.ElapsedMilliseconds
  [Console]::Out.Write((ConvertTo-Json $obj -Depth 4 -Compress))
  [Console]::Out.Write("`n")
  exit 0
}

try {
  Add-Type -AssemblyName System.Drawing, System.Windows.Forms -ErrorAction Stop
  if ($IncludeLayered -and -not ('CLS.Gdi' -as [type])) {
    # .NET's CopyFromScreen validates its enum and so cannot express SRCCOPY|CAPTUREBLT; the raw
    # GDI call can.
    Add-Type -Namespace CLS -Name Gdi -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr GetDesktopWindow();
[DllImport("user32.dll")] public static extern IntPtr GetWindowDC(IntPtr h);
[DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr h, IntPtr dc);
[DllImport("gdi32.dll")] public static extern bool BitBlt(IntPtr dst, int x, int y, int w, int h, IntPtr src, int sx, int sy, uint rop);
'@ -ErrorAction Stop
  }

  # The WHOLE virtual desktop, every monitor, in physical pixels. The origin is usually (0,0)
  # but is negative when a monitor sits to the left of the primary — every emitted JSON carries
  # x/y so the caller can map screenshot pixels back to screen pixels.
  $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
  # How many physical screens the untrimmed desktop spans. Additive: every existing field keeps
  # its meaning, this one only answers a question the width could never answer on its own.
  $monitors = @([System.Windows.Forms.Screen]::AllScreens).Count
  # an explicit clip rect narrows the capture to exactly that region of the screen
  if ($Mode -ne 'crop' -and $W -gt 0 -and $H -gt 0) {
    $b = New-Object System.Drawing.Rectangle $X, $Y, $W, $H
    # A clipped capture is one rectangle of one screen unless it genuinely straddles two.
    $monitors = @([System.Windows.Forms.Screen]::AllScreens | Where-Object { $_.Bounds.IntersectsWith($b) }).Count
  }

  function Grab([string]$dest) {
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    # 0x00CC0020 SRCCOPY | 0x40000000 CAPTUREBLT — the enum has no combined member, so the raw
    # ROP value is cast in
    $op = if ($IncludeLayered) {
      [System.Drawing.CopyPixelOperation]0x40CC0020
    } else {
      [System.Drawing.CopyPixelOperation]::SourceCopy
    }
    if ($IncludeLayered) {
      $desk = [CLS.Gdi]::GetDesktopWindow()
      $srcDc = [CLS.Gdi]::GetWindowDC($desk)
      $dstDc = $g.GetHdc()
      [void][CLS.Gdi]::BitBlt($dstDc, 0, 0, $b.Width, $b.Height, $srcDc, $b.X, $b.Y, 0x40CC0020)
      $g.ReleaseHdc($dstDc)
      [void][CLS.Gdi]::ReleaseDC($desk, $srcDc)
    } else {
      $g.CopyFromScreen($b.X, $b.Y, 0, 0, $bmp.Size, $op)
    }
    $g.Dispose()
    $bmp.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
  }

  switch ($Mode) {
    'capture' {
      if (-not $Path) { Emit ([ordered]@{ ok = $false; error = 'No -Path'; ms = 0 }) }
      Grab $Path
      Emit ([ordered]@{ ok = $true; path = $Path; w = $b.Width; h = $b.Height; x = $b.X; y = $b.Y; monitors = $monitors; ms = 0 })
    }
    'burst' {
      if (-not $Path) { Emit ([ordered]@{ ok = $false; error = 'No -Path'; ms = 0 }) }
      $paths = @()
      for ($i = 0; $i -lt $Count; $i++) {
        $p = "$Path-$i.png"
        Grab $p
        $paths += $p
        if ($i -lt $Count - 1 -and $DelayMs -gt 0) { Start-Sleep -Milliseconds $DelayMs }
      }
      Emit ([ordered]@{ ok = $true; paths = $paths; w = $b.Width; h = $b.Height; x = $b.X; y = $b.Y; monitors = $monitors; ms = 0 })
    }
    'crop' {
      if (-not (Test-Path $In)) { Emit ([ordered]@{ ok = $false; error = "No such capture: $In"; ms = 0 }) }
      $src = [System.Drawing.Image]::FromFile($In)
      # clamp so a target near an edge still produces a legal rect
      $cw = [Math]::Min($W, $src.Width)
      $ch = [Math]::Min($H, $src.Height)
      $cx = [Math]::Max(0, [Math]::Min($X, $src.Width - $cw))
      $cy = [Math]::Max(0, [Math]::Min($Y, $src.Height - $ch))
      $rect = New-Object System.Drawing.Rectangle $cx, $cy, $cw, $ch
      $out = New-Object System.Drawing.Bitmap $cw, $ch
      $g = [System.Drawing.Graphics]::FromImage($out)
      $g.DrawImage($src, (New-Object System.Drawing.Rectangle 0, 0, $cw, $ch), $rect, [System.Drawing.GraphicsUnit]::Pixel)
      $g.Dispose()
      $out.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
      $out.Dispose()
      $src.Dispose()
      Emit ([ordered]@{ ok = $true; path = $Path; w = $cw; h = $ch; x = $cx; y = $cy; ms = 0 })
    }
    default { Emit ([ordered]@{ ok = $false; error = "Unknown mode $Mode"; ms = 0 }) }
  }
}
catch {
  Emit ([ordered]@{ ok = $false; error = ($_.Exception.Message -replace '\s+', ' '); ms = 0 })
}
