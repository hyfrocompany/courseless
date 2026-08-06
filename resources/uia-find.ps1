# uia-find.ps1 — ground a named on-screen UI element to exact screen coordinates.
#
# Courseless points at things; it never clicks them. This script is the EXACT half of the
# grounding pipeline: rects come straight out of the OS accessibility tree, so a hit is correct
# by construction. (The vision fallback in PointService handles what UIA cannot name.)
#
# MODES
#   -Mode name        (default) find elements whose Name matches -Name
#   -Mode from-point  the element under -X,-Y (or the current cursor) — used by B5 record mode
#   -Mode windows     just report the candidate window list (diagnostics)
#
# The CLI-ish spellings `--name <text>` and `--from-point` are accepted too, because the B5
# recorder shells out with that shape.
#
# OUTPUT  one line of compact JSON, always, even on failure:
#   { ok, mode, ms, foreground:{hwnd,title,process,pid,self},
#     windows:[{hwnd,title,process,pid,how,self}],
#     matches:[{x,y,w,h,name,controlType,exact,how,windowHwnd,windowTitle,process,pid,self}],
#     error? }
#   `x,y` is the element CENTRE in physical screen pixels (same space as CopyFromScreen).
#
# Windows only. PowerShell 5.1. Never writes anything, never clicks anything.

[CmdletBinding()]
param(
  [string]$Mode = 'name',
  [string]$Name = '',
  [string]$WindowHint = '',
  [int]$X = -2147483648,
  [int]$Y = -2147483648,
  [string]$ExcludePid = '',
  [string]$ExcludeHwnd = '',
  [int]$Max = 8,
  [int]$BudgetMs = 1400,
  # auto: fall back to MSAA only when the UIA name search found nothing at all.
  # only: skip UIA entirely and search MSAA. The caller asks for this when the UIA matches it got
  #       were all unusable (prose, wrong window) — a decision only the caller can make, since
  #       this script deliberately holds no policy about what a good target is.
  # off:  UIA only.
  [ValidateSet('auto', 'only', 'off')]
  [string]$Msaa = 'auto',
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Rest = @()
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$sw = [System.Diagnostics.Stopwatch]::StartNew()

# ------------------------------------------------------------------ CLI-shaped aliases
for ($i = 0; $i -lt $Rest.Count; $i++) {
  switch -Regex ($Rest[$i]) {
    '^--from-point$' { $Mode = 'from-point' }
    '^--name$' { if ($i + 1 -lt $Rest.Count) { $Name = $Rest[$i + 1]; $i++ }; $Mode = 'name' }
    '^--window-hint$' { if ($i + 1 -lt $Rest.Count) { $WindowHint = $Rest[$i + 1]; $i++ } }
  }
}

$excluded = @()
if ($ExcludePid) {
  foreach ($p in ($ExcludePid -split '[,; ]+')) { if ($p -match '^\d+$') { $excluded += [int]$p } }
}
# Windows that can never contain a lesson target — our own pointer overlay, above all: it is a
# full-screen transparent sheet in the same process as the app, so a naive "main window of the
# matching process" lookup binds to IT and finds nothing.
$excludedHwnd = @()
if ($ExcludeHwnd) {
  foreach ($p in ($ExcludeHwnd -split '[,; ]+')) { if ($p -match '^\d+$') { $excludedHwnd += [int64]$p } }
}

# ------------------------------------------------------------------ result shell
$result = [ordered]@{
  ok          = $false
  mode        = $Mode
  ms          = 0
  foreground  = $null
  windows     = @()
  matches     = @()
}

function Emit {
  param($obj)
  $obj.ms = [int]$sw.ElapsedMilliseconds
  # -Compress keeps it to one line; Node reads exactly one line of stdout.
  [Console]::Out.Write((ConvertTo-Json $obj -Depth 6 -Compress))
  [Console]::Out.Write("`n")
  exit 0
}

try {
  # WindowsBase carries System.Windows.Point, which AutomationElement.FromPoint takes.
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase, System.Drawing -ErrorAction Stop

  if (-not ('CL.Win32' -as [type])) {
    Add-Type -Namespace CL -Name Win32 -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int pid);
[DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
[DllImport("user32.dll")] public static extern IntPtr GetTopWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, System.Text.StringBuilder s, int n);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr hWnd, System.Text.StringBuilder s, int n);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowW(string cls, string title);
[DllImport("user32.dll")] public static extern bool GetCursorPos(out System.Drawing.Point p);
[DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);
'@ -ReferencedAssemblies System.Drawing -ErrorAction Stop
  }

  # ---------------------------------------------------------------- MSAA (the older tree)
  #
  # Managed UI Automation cannot see inside a NetUIHWND — the host the Windows Ribbon Framework
  # draws into. In File Explorer that is the ENTIRE ribbon: "New folder", "Rename", "Copy" and
  # every other button a walkthrough is actually about come back as one anonymous Pane.
  # Those controls do implement the older MSAA (IAccessible) interface, with real names and real
  # rects, so this is a fallback to a different OS API rather than a guess: the accuracy contract
  # is unchanged, the source of truth is just one layer down.
  if (-not ('CL.Msaa' -as [type])) {
    Add-Type -Namespace CL -Name Msaa -MemberDefinition @'
[DllImport("oleacc.dll")] public static extern int AccessibleObjectFromPoint(PT pt, [MarshalAs(UnmanagedType.IDispatch)] out object acc, out object child);
[DllImport("oleacc.dll")] public static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint id, ref Guid iid, [MarshalAs(UnmanagedType.IDispatch)] out object acc);
[DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, EnumProc cb, IntPtr lp);
public delegate bool EnumProc(IntPtr h, IntPtr lp);
[StructLayout(LayoutKind.Sequential)] public struct PT { public int x; public int y; }
'@ -ErrorAction Stop
  }

  # OBJID_CLIENT. The window-level object (OBJID_WINDOW) only exposes the frame — title bar,
  # scroll bars — and its children are simple element ids that lead nowhere.
  $OBJID_CLIENT = [uint32]4294967292

  # MSAA role number -> the ControlType spelling the rest of Courseless already speaks.
  $MSAA_ROLE = @{
    9 = 'Window'; 10 = 'Pane'; 11 = 'Menu'; 12 = 'MenuItem'; 13 = 'ToolTip'; 15 = 'Document';
    16 = 'Pane'; 18 = 'Window'; 20 = 'Group'; 21 = 'Separator'; 22 = 'ToolBar'; 23 = 'StatusBar';
    24 = 'Table'; 25 = 'Header'; 29 = 'DataItem'; 30 = 'Hyperlink'; 33 = 'List'; 34 = 'ListItem';
    35 = 'Tree'; 36 = 'TreeItem'; 37 = 'TabItem'; 40 = 'Image'; 41 = 'Text'; 42 = 'Edit';
    43 = 'Button'; 44 = 'CheckBox'; 45 = 'RadioButton'; 46 = 'ComboBox'; 47 = 'ComboBox';
    48 = 'ProgressBar'; 51 = 'Slider'; 52 = 'Spinner'; 56 = 'SplitButton'; 57 = 'SplitButton';
    58 = 'SplitButton'; 60 = 'Tab'; 62 = 'SplitButton'
  }

  $ACC_INVOKE = [System.Reflection.BindingFlags]::InvokeMethod
  $ACC_GET = [System.Reflection.BindingFlags]::GetProperty

  function Get-AccProp($acc, [string]$prop, $child) {
    try { return $acc.GetType().InvokeMember($prop, $ACC_GET, $null, $acc, @($child)) } catch { return $null }
  }

  # accLocation returns four ByRef ints, which late binding only passes correctly with an
  # explicit ParameterModifier.
  function Get-AccRect($acc, $child) {
    try {
      $vals = [object[]]@(0, 0, 0, 0, $child)
      $mod = New-Object System.Reflection.ParameterModifier 5
      0..3 | ForEach-Object { $mod[$_] = $true }
      [void]$acc.GetType().InvokeMember('accLocation', $ACC_INVOKE, $null, $acc, $vals, @($mod), $null, $null)
      return @{ x = [int]$vals[0]; y = [int]$vals[1]; w = [int]$vals[2]; h = [int]$vals[3] }
    } catch { return $null }
  }

  function Get-AccRole($acc, $child) {
    $r = Get-AccProp $acc 'accRole' $child
    if ($null -eq $r) { return 'Custom' }
    try { $n = [int]$r } catch { return 'Custom' }
    if ($MSAA_ROLE.ContainsKey($n)) { return $MSAA_ROLE[$n] }
    return 'Custom'
  }

  # STATE_SYSTEM_INVISIBLE (0x8000) / OFFSCREEN (0x10000): never point at something not on screen.
  function Test-AccVisible($acc, $child) {
    $s = Get-AccProp $acc 'accState' $child
    if ($null -eq $s) { return $true }
    try { $n = [int]$s } catch { return $true }
    return -not (($n -band 0x8000) -or ($n -band 0x10000))
  }

  function Get-MsaaAtPoint([int]$px, [int]$py) {
    $pt = New-Object CL.Msaa+PT
    $pt.x = $px; $pt.y = $py
    $acc = $null; $child = $null
    try { $hr = [CL.Msaa]::AccessibleObjectFromPoint($pt, [ref]$acc, [ref]$child) } catch { return $null }
    if ($hr -ne 0 -or $null -eq $acc) { return $null }
    $name = Get-AccProp $acc 'accName' $child
    if (-not $name) { return $null }
    $rect = Get-AccRect $acc $child
    if ($null -eq $rect -or $rect.w -le 0 -or $rect.h -le 0) { return $null }
    return @{
      name = [string]$name
      role = (Get-AccRole $acc $child)
      rect = $rect
      description = [string](Get-AccProp $acc 'accDescription' $child)
    }
  }

  # accChildCount takes no arguments — passing one makes late binding fail silently and report a
  # childless tree, which looks exactly like "nothing here" and is not.
  function Get-AccChildCount($acc) {
    try { return [int]$acc.GetType().InvokeMember('accChildCount', $ACC_GET, $null, $acc, @()) } catch { return 0 }
  }

  # Bounded walk of a window's MSAA tree.
  #
  # It starts from the CHILD WINDOWS, not from the top-level window: a top-level window's
  # accessible children are simple element ids (title bar, scroll bars) that lead nowhere, while
  # the interesting controls live in child HWNDs — the ribbon's NetUIHWND, a toolbar, a pane.
  # Within each, children arrive either as their own IAccessible or as a child id belonging to
  # the parent, and both shapes are handled here so callers never have to care.
  function Search-Msaa([IntPtr]$hwnd, [string]$needleLower, [bool]$allowPartial, [int]$maxHits, [int]$budgetMs) {
    $hits = New-Object System.Collections.ArrayList
    $iid = [Guid]'618736e0-3c3d-11cf-810c-00aa00389b71'   # IID_IAccessible
    $sw2 = [System.Diagnostics.Stopwatch]::StartNew()
    $seen = @{}

    $childWindows = New-Object System.Collections.ArrayList
    $cb = [CL.Msaa+EnumProc] {
      param($h, $l)
      [void]$childWindows.Add($h)
      return $true
    }
    try { [void][CL.Msaa]::EnumChildWindows($hwnd, $cb, [IntPtr]::Zero) } catch { }
    $roots = @($hwnd) + @($childWindows)

    $nodes = 0
    foreach ($rootHwnd in $roots) {
      if ($hits.Count -ge $maxHits -or $sw2.ElapsedMilliseconds -ge $budgetMs) { break }
      $root = $null
      try { $hr = [CL.Msaa]::AccessibleObjectFromWindow($rootHwnd, $OBJID_CLIENT, [ref]$iid, [ref]$root) } catch { continue }
      if ($hr -ne 0 -or $null -eq $root) { continue }

      $queue = New-Object System.Collections.Generic.Queue[object]
      $queue.Enqueue(@{ acc = $root; depth = 0 })
      while ($queue.Count -gt 0 -and $nodes -lt 3000 -and $sw2.ElapsedMilliseconds -lt $budgetMs -and $hits.Count -lt $maxHits) {
        $item = $queue.Dequeue()
        $acc = $item.acc
        $depth = $item.depth
        $nodes++
        $count = Get-AccChildCount $acc
        if ($count -le 0 -or $count -gt 400) { continue }
        for ($ci = 1; $ci -le $count; $ci++) {
          if ($hits.Count -ge $maxHits -or $sw2.ElapsedMilliseconds -ge $budgetMs) { break }
          $kid = $null
          try { $kid = $acc.GetType().InvokeMember('accChild', $ACC_GET, $null, $acc, @([int]$ci)) } catch { $kid = $null }
          $target = if ($null -ne $kid) { $kid } else { $acc }
          $childId = if ($null -ne $kid) { 0 } else { [int]$ci }
          $nm = Get-AccProp $target 'accName' $childId
          if ($nm) {
            $lower = ([string]$nm).ToLowerInvariant()
            $exact = $lower -eq $needleLower
            $contains = $lower.Contains($needleLower)
            $partial = $allowPartial -and $needleLower.Length -ge 6 -and $lower.Length -ge 4 -and
                       ($needleLower -match "(^|\s)$([regex]::Escape($lower))(\s|$)")
            if (($exact -or $contains -or $partial) -and (Test-AccVisible $target $childId)) {
              $rect = Get-AccRect $target $childId
              if ($null -ne $rect -and $rect.w -gt 0 -and $rect.h -gt 0 -and $rect.w -lt 4000) {
                # The same control shows up more than once (the ribbon exposes a command and its
                # button separately) — one rect is one answer.
                $key = "$($rect.x),$($rect.y),$($rect.w),$($rect.h)"
                if (-not $seen.ContainsKey($key)) {
                  $seen[$key] = $true
                  [void]$hits.Add(@{
                      name = [string]$nm
                      role = (Get-AccRole $target $childId)
                      rect = $rect
                      exact = [bool]$exact
                      how = if ($exact) { 'exact' } elseif ($contains) { 'contains' } else { 'partial' }
                    })
                }
              }
            }
          }
          if ($null -ne $kid -and $depth -lt 12) { $queue.Enqueue(@{ acc = $kid; depth = $depth + 1 }) }
        }
      }
    }
    return $hits
  }

  function Get-WinText([IntPtr]$h) {
    $sb = New-Object System.Text.StringBuilder 512
    [void][CL.Win32]::GetWindowTextW($h, $sb, 512)
    $sb.ToString()
  }
  function Get-WinClass([IntPtr]$h) {
    $sb = New-Object System.Text.StringBuilder 256
    [void][CL.Win32]::GetClassNameW($h, $sb, 256)
    $sb.ToString()
  }
  function Get-WinPid([IntPtr]$h) {
    $p = 0
    [void][CL.Win32]::GetWindowThreadProcessId($h, [ref]$p)
    $p
  }
  function Get-ProcName([int]$p) {
    try { (Get-Process -Id $p -ErrorAction Stop).ProcessName } catch { '' }
  }

  function New-WinInfo([IntPtr]$h, [string]$how) {
    if ($h -eq [IntPtr]::Zero) { return $null }
    $p = Get-WinPid $h
    [ordered]@{
      hwnd    = [int64]$h
      title   = (Get-WinText $h)
      class   = (Get-WinClass $h)
      process = (Get-ProcName $p)
      pid     = $p
      how     = $how
      self    = ($excluded -contains $p)
    }
  }

  # ---------------------------------------------------------------- candidate windows
  $fgH = [CL.Win32]::GetForegroundWindow()
  $fg = New-WinInfo $fgH 'foreground'
  $result.foreground = $fg

  $cands = New-Object System.Collections.ArrayList
  $seenH = @{}
  function Add-Cand($info) {
    if ($null -eq $info) { return }
    if ($excludedHwnd -contains $info.hwnd) { return }
    if ($seenH.ContainsKey($info.hwnd)) { return }
    $seenH[$info.hwnd] = $true
    [void]$cands.Add($info)
  }

  Add-Cand $fg

  # Every visible top-level window, in Z-order. Walking the Z-order (rather than trusting
  # Process.MainWindowHandle) is what makes multi-window apps work: File Explorer folders and a
  # second browser window are separate top-level windows that MainWindowHandle never reports.
  $tops = New-Object System.Collections.ArrayList
  $h = [CL.Win32]::GetTopWindow([IntPtr]::Zero)
  for ($n = 0; $n -lt 900 -and $h -ne [IntPtr]::Zero; $n++) {
    if ([CL.Win32]::IsWindowVisible($h) -and -not [CL.Win32]::IsIconic($h)) {
      $t = Get-WinText $h
      if ($t) { [void]$tops.Add(@{ h = $h; title = $t; cls = (Get-WinClass $h); procId = (Get-WinPid $h) }) }
    }
    $h = [CL.Win32]::GetWindow($h, 2) # GW_HWNDNEXT
  }

  # The window BEHIND us: when the point is triggered from Courseless itself, the app the learner
  # is actually working in is one step down the Z-order.
  foreach ($w in $tops) {
    if ($excluded -contains $w.procId) { continue }
    if ($excludedHwnd -contains [int64]$w.h) { continue }
    if ($w.cls -eq 'Shell_TrayWnd' -or $w.cls -eq 'Shell_SecondaryTrayWnd' -or $w.cls -eq 'Progman' -or $w.cls -eq 'WorkerW') { continue }
    if ([int64]$w.h -eq [int64]$fgH) { continue }
    Add-Cand (New-WinInfo $w.h 'behind')
    break
  }

  # Windows matching the lesson's tool hint (title or process name).
  if ($WindowHint) {
    $tokens = @($WindowHint -split '[^A-Za-z0-9\+\#]+' | Where-Object { $_.Length -ge 3 })
    if ($tokens.Count -gt 0) {
      $added = 0
      foreach ($w in $tops) {
        if ($added -ge 6) { break }
        $pn = Get-ProcName $w.procId
        $hit = $false
        foreach ($tok in $tokens) {
          if ($w.title -like "*$tok*") { $hit = $true; break }
          if ($pn -and $pn -like "*$tok*") { $hit = $true; break }
        }
        if ($hit) {
          if (-not $seenH.ContainsKey([int64]$w.h)) { $added++ }
          Add-Cand (New-WinInfo $w.h 'hint')
        }
      }
    }
  }

  # The shell: taskbar + Start. Always a legitimate target ("open PowerShell from Start").
  $tray = [CL.Win32]::FindWindowW('Shell_TrayWnd', $null)
  if ($tray -ne [IntPtr]::Zero) { Add-Cand (New-WinInfo $tray 'taskbar') }

  $result.windows = @($cands)

  if ($Mode -eq 'windows') {
    $result.ok = $true
    Emit $result
  }

  # ---------------------------------------------------------------- from-point (B5 record mode)
  if ($Mode -eq 'from-point') {
    $px = $X; $py = $Y
    if ($px -eq -2147483648 -or $py -eq -2147483648) {
      $pt = New-Object System.Drawing.Point
      [void][CL.Win32]::GetCursorPos([ref]$pt)
      $px = $pt.X; $py = $pt.Y
    }
    $el = [System.Windows.Automation.AutomationElement]::FromPoint((New-Object System.Windows.Point($px, $py)))
    if ($null -eq $el) { $result.error = 'No automation element under the point.'; Emit $result }
    $r = $el.Current.BoundingRectangle
    # A mark is only worth keeping if it CAUGHT something. When UIA hands back an anonymous host
    # (the ribbon's NetUIHWND, a custom-drawn toolbar), ask MSAA at the same pixel: it is a
    # different OS API reading the same control, not a guess about it.
    $msaaHit = $null
    $uiaName = ''
    try { $uiaName = $el.Current.Name } catch { }
    if (-not $uiaName) { $msaaHit = Get-MsaaAtPoint $px $py }
    $ownerH = [IntPtr]$el.Current.NativeWindowHandle
    if ($ownerH -eq [IntPtr]::Zero) {
      try {
        $w = [System.Windows.Automation.TreeWalker]::ControlViewWalker
        $cur = $el
        while ($null -ne $cur -and [IntPtr]$cur.Current.NativeWindowHandle -eq [IntPtr]::Zero) { $cur = $w.GetParent($cur) }
        if ($null -ne $cur) { $ownerH = [IntPtr]$cur.Current.NativeWindowHandle }
      } catch { }
    }
    # The handle an element reports is often a CHILD window — the ribbon's NetUIHWND, a toolbar
    # host — which has no title. A mark records which APP the author was in, so climb to the
    # top-level window (GA_ROOT = 2) that actually carries the name.
    if ($ownerH -ne [IntPtr]::Zero) {
      try {
        $rootH = [CL.Win32]::GetAncestor($ownerH, 2)
        if ($rootH -ne [IntPtr]::Zero) { $ownerH = $rootH }
      } catch { }
    }
    $ownerPid = if ($ownerH -ne [IntPtr]::Zero) { Get-WinPid $ownerH } else { $el.Current.ProcessId }
    # The deepest element under a pixel is often an unnamed leaf; the name the user would say is
    # usually a step or two up. Report the chain so the caller can match on any of it.
    $ancestors = New-Object System.Collections.ArrayList
    try {
      $w2 = [System.Windows.Automation.TreeWalker]::ControlViewWalker
      $cur2 = $w2.GetParent($el)
      for ($k = 0; $k -lt 5 -and $null -ne $cur2; $k++) {
        $n2 = ''
        try { $n2 = $cur2.Current.Name } catch { }
        if ($n2) { [void]$ancestors.Add($n2) }
        $cur2 = $w2.GetParent($cur2)
      }
    } catch { }
    $useMsaa = ($null -ne $msaaHit)
    $result.matches = @(
      [ordered]@{
        x           = if ($useMsaa) { [int]($msaaHit.rect.x + $msaaHit.rect.w / 2) } else { [int][Math]::Round($r.X + $r.Width / 2) }
        y           = if ($useMsaa) { [int]($msaaHit.rect.y + $msaaHit.rect.h / 2) } else { [int][Math]::Round($r.Y + $r.Height / 2) }
        left        = if ($useMsaa) { [int]$msaaHit.rect.x } else { [int][Math]::Round($r.X) }
        top         = if ($useMsaa) { [int]$msaaHit.rect.y } else { [int][Math]::Round($r.Y) }
        w           = if ($useMsaa) { [int]$msaaHit.rect.w } else { [int][Math]::Round($r.Width) }
        h           = if ($useMsaa) { [int]$msaaHit.rect.h } else { [int][Math]::Round($r.Height) }
        name        = if ($useMsaa) { $msaaHit.name } else { $uiaName }
        ancestors   = @($ancestors)
        controlType = if ($useMsaa) { $msaaHit.role } else { ($el.Current.ControlType.ProgrammaticName -replace '^ControlType\.', '') }
        automationId = $el.Current.AutomationId
        className   = $el.Current.ClassName
        exact       = $true
        how         = if ($useMsaa) { 'from-point/msaa' } else { 'from-point' }
        windowHwnd  = [int64]$ownerH
        windowTitle = if ($ownerH -ne [IntPtr]::Zero) { Get-WinText $ownerH } else { '' }
        process     = (Get-ProcName $ownerPid)
        pid         = $ownerPid
        self        = ($excluded -contains $ownerPid)
        pointX      = $px
        pointY      = $py
      }
    )
    $result.ok = $true
    Emit $result
  }

  # ---------------------------------------------------------------- name search
  if (-not $Name) { $result.error = 'No -Name given.'; Emit $result }

  $needle = $Name.Trim()
  $needleLower = $needle.ToLowerInvariant()
  # The "partial" rule below lets a short element name satisfy a longer query — "Windows Start"
  # finding the Start button. It must NOT let a long descriptive query latch onto whatever short
  # word it happens to contain: asking for "blue gradient cover image on the first featured
  # lesson card" once matched a section label called "FEATURED" and pointed at the wrong thing.
  # Label-shaped queries only.
  $needleWords = @($needleLower -split '\s+' | Where-Object { $_ })
  $allowPartial = $needleWords.Count -le 4
  $found = New-Object System.Collections.ArrayList

  function Add-Match($el, $win, $exact, $how) {
    try { $r = $el.Current.BoundingRectangle } catch { return }
    if ($r.Width -le 0 -or $r.Height -le 0) { return }
    if ([double]::IsInfinity($r.X) -or [double]::IsInfinity($r.Y)) { return }
    if ($r.Width -gt 4000 -and $r.Height -gt 3000) { return }  # whole-desktop rects are not targets
    try { if ($el.Current.IsOffscreen) { return } } catch { }
    [void]$found.Add([ordered]@{
        x            = [int][Math]::Round($r.X + $r.Width / 2)
        y            = [int][Math]::Round($r.Y + $r.Height / 2)
        left         = [int][Math]::Round($r.X)
        top          = [int][Math]::Round($r.Y)
        w            = [int][Math]::Round($r.Width)
        h            = [int][Math]::Round($r.Height)
        name         = $el.Current.Name
        controlType  = ($el.Current.ControlType.ProgrammaticName -replace '^ControlType\.', '')
        automationId = $el.Current.AutomationId
        exact        = [bool]$exact
        how          = $how
        windowHwnd   = $win.hwnd
        windowTitle  = $win.title
        process      = $win.process
        pid          = $win.pid
        self         = $win.self
      })
  }

  $trueCond = [System.Windows.Automation.Condition]::TrueCondition
  $nameProp = [System.Windows.Automation.AutomationElement]::NameProperty
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker

  foreach ($win in $cands) {
    if ($Msaa -eq 'only') { break }
    if ($found.Count -ge $Max) { break }
    $root = $null
    try { $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$win.hwnd) } catch { continue }
    if ($null -eq $root) { continue }

    # 1) exact Name — native filtering, fast even on a Chromium tree
    try {
      $cond = New-Object System.Windows.Automation.PropertyCondition($nameProp, $needle)
      foreach ($el in $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)) {
        Add-Match $el $win $true "$($win.how)/exact"
        if ($found.Count -ge $Max) { break }
      }
    } catch { }

    if ($found.Count -ge $Max) { break }

    # 2) contains / case-insensitive — bounded BFS so a huge tree cannot hang the point
    $budget = [System.Diagnostics.Stopwatch]::StartNew()
    $queue = New-Object System.Collections.Generic.Queue[object]
    try { $queue.Enqueue($root) } catch { continue }
    $nodes = 0
    while ($queue.Count -gt 0 -and $nodes -lt 4000 -and $budget.ElapsedMilliseconds -lt $BudgetMs) {
      $node = $queue.Dequeue()
      $nodes++
      $child = $null
      try { $child = $walker.GetFirstChild($node) } catch { $child = $null }
      while ($null -ne $child) {
        $nm = ''
        try { $nm = $child.Current.Name } catch { $nm = '' }
        if ($nm) {
          $lower = $nm.ToLowerInvariant()
          if ($lower -eq $needleLower) { Add-Match $child $win $true "$($win.how)/ci" }
          elseif ($lower.Contains($needleLower)) { Add-Match $child $win $false "$($win.how)/contains" }
          elseif ($allowPartial -and $needleLower.Length -ge 6 -and $lower.Length -ge 4 -and
                  $needleLower -match "(^|\s)$([regex]::Escape($lower))(\s|$)") {
            Add-Match $child $win $false "$($win.how)/partial"
          }
        }
        try { $queue.Enqueue($child) } catch { }
        if ($found.Count -ge $Max) { break }
        try { $child = $walker.GetNextSibling($child) } catch { $child = $null }
      }
      if ($found.Count -ge $Max) { break }
    }
    if ($found.Count -ge $Max) { break }
  }

  # ---------------------------------------------------------------- MSAA fallback
  #
  # UIA is richer and better scoped, so it stays the first answer; this exists for the windows
  # whose controls are invisible to it — the File Explorer ribbon above all, which is where a
  # recorded walkthrough usually starts.
  #
  # `-Msaa only` is the caller saying "everything UIA gave me was unusable". That happens for a
  # reason this script cannot see: Courseless's own runner displays the step text, so searching
  # for "New folder" finds the SENTENCE "Click New folder on the Home tab" in our own window and
  # the search stops looking, one layer above the button the learner actually needs.
  if ($found.Count -eq 0 -or $Msaa -eq 'only') {
    # ONE budget for the whole fallback, not one per window. Six candidate windows each given
    # the full budget is a six-second point, and a pointer that arrives after the learner has
    # given up is not a pointer.
    $msaaDeadline = $sw.ElapsedMilliseconds + $BudgetMs + 600
    $searched = 0
    foreach ($win in $cands) {
      if ($found.Count -ge $Max -or $searched -ge 4) { break }
      $left = [int]($msaaDeadline - $sw.ElapsedMilliseconds)
      if ($left -lt 120) { break }
      $searched++
      $hits = Search-Msaa ([IntPtr]$win.hwnd) $needleLower $allowPartial ($Max - $found.Count) $left
      foreach ($m in $hits) {
        [void]$found.Add([ordered]@{
            x            = [int]($m.rect.x + $m.rect.w / 2)
            y            = [int]($m.rect.y + $m.rect.h / 2)
            left         = [int]$m.rect.x
            top          = [int]$m.rect.y
            w            = [int]$m.rect.w
            h            = [int]$m.rect.h
            name         = $m.name
            controlType  = $m.role
            automationId = ''
            exact        = $m.exact
            how          = "$($win.how)/msaa-$($m.how)"
            windowHwnd   = $win.hwnd
            windowTitle  = $win.title
            process      = $win.process
            pid          = $win.pid
            self         = $win.self
          })
        if ($found.Count -ge $Max) { break }
      }
    }
  }

  $result.matches = @($found)
  $result.ok = $true
  Emit $result
}
catch {
  $result.error = ($_.Exception.Message -replace '\s+', ' ')
  Emit $result
}
