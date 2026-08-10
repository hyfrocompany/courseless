// Mocks of the running app, built from its own parts so they cannot drift:
//   GhostArrow  : the overlay glyph (src/renderer/src/Overlay.tsx)
//   Widget      : the pinned coach (src/renderer/src/Float.tsx)
//   HeroStage   : both of them over a spreadsheet, mid-lesson
//   PointStage  : the same pointer in a different app, close up
//
// Every line of step text is lifted from resources/seed-lessons: the hero runs
// 10-pivot-tables-in-one-sitting.json, the close-up runs 13-auto-layout-that-behaves.json.

import { ChatIcon, ExpandIcon, PointerIcon } from './icons'

/** The tinted arrow with a white keyline, so it reads on any background. */
export function GhostArrow() {
  return (
    <svg className="ghost-arrow" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M1.6 1.2 L15.4 12.6 L9.1 13.4 L12.6 20.6 L9.4 22.1 L6.1 14.8 L1.6 18.6 Z"
        fill="#ffffff"
        stroke="#ffffff"
        strokeWidth="3.2"
        strokeLinejoin="round"
      />
      <path
        d="M1.6 1.2 L15.4 12.6 L9.1 13.4 L12.6 20.6 L9.4 22.1 L6.1 14.8 L1.6 18.6 Z"
        fill="#0e1a22"
        stroke="#0b96ea"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M3.1 3.6 L3.1 15.2 L6.2 12.6" stroke="#36b0fa" strokeWidth="1.1" strokeLinecap="round" opacity="0.9" />
    </svg>
  )
}

function Ghost({ className, label }: { className: string; label: string }) {
  return (
    <div className={`ghost ${className}`} aria-hidden="true">
      <span className="ripple" />
      <span className="ripple r2" />
      <GhostArrow />
      <span className="callout">
        <i />
        {label}
      </span>
    </div>
  )
}

const SHEET: Array<[string, string, string]> = [
  ['North', 'Trail 40', '12,480'],
  ['North', 'Ridge 22', '8,210'],
  ['South', 'Trail 40', '15,300'],
  ['South', 'Ridge 22', '9,140'],
  ['East', 'Alpine 9', '11,050'],
  ['East', 'Trail 40', '7,620']
]

/** The spreadsheet the pivot lesson runs in. Stylized, but it behaves like a sheet. */
function SheetApp() {
  return (
    <div className="desk" aria-hidden="true">
      <div className="desk-bar">
        <i />
        <i />
        <i />
        <span className="desk-file">Q3 sales</span>
      </div>

      <div className="ribbon">
        <span className="tab">File</span>
        <span className="tab">Home</span>
        <span className="tab target">Insert</span>
        <span className="tab">Data</span>
        <span className="tab">Review</span>
        <span className="tab">View</span>
      </div>

      <div className="fbar">
        <span className="namebox">A2</span>
        <span className="fx">fx</span>
        <span className="fval">North</span>
      </div>

      <div className="grid">
        <span className="ch corner" />
        <span className="ch">A</span>
        <span className="ch">B</span>
        <span className="ch">C</span>
        <span className="ch">D</span>

        <span className="rh">1</span>
        <span className="cell head">Region</span>
        <span className="cell head">Product</span>
        <span className="cell head num">Sales</span>
        <span className="cell" />

        {SHEET.map((row, i) => (
          <span key={`r${i}`} style={{ display: 'contents' }}>
            <span className="rh">{i + 2}</span>
            <span className={`cell${i === 0 ? ' sel' : ''}`}>{row[0]}</span>
            <span className="cell">{row[1]}</span>
            <span className="cell num">{row[2]}</span>
            <span className="cell" />
          </span>
        ))}

        <span className="rh">8</span>
        <span className="cell" />
        <span className="cell" />
        <span className="cell" />
        <span className="cell" />
      </div>
    </div>
  )
}

export function Widget() {
  return (
    <div className="widget" aria-hidden="true">
      <div className="w-bar">
        <span className="w-dots">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
        <span className="w-prog">2/10</span>
        <span className="w-title">Pivot tables in one sitting</span>
        <span className="w-ico">
          <ChatIcon />
        </span>
        <span className="w-ico">
          <ExpandIcon />
        </span>
      </div>
      <div className="w-body">
        <p className="w-action">Open the Create PivotTable dialog.</p>
        <p className="w-where">Insert tab on the ribbon, PivotTable button in the Tables group.</p>
        <p className="w-check">
          <em>you should see</em> The Create PivotTable dialog is visible and the Table/Range box contains a cell
          range.
        </p>
      </div>
      <div className="w-actions">
        <div className="w-row">
          <span className="w-btn did">Did it</span>
          <span className="w-btn show">
            <PointerIcon />
            Show me
          </span>
          <span className="w-btn">Hint</span>
          <span className="w-btn quiet">Skip</span>
        </div>
        <div className="w-keys">
          <span>
            <b>Space</b> did it
          </span>
          <span>
            <b>H</b> hint
          </span>
          <span>
            <b>P</b> show me
          </span>
          <span>
            <b>C</b> coach
          </span>
        </div>
      </div>
    </div>
  )
}

export function HeroStage() {
  return (
    <div className="stage-wrap">
      <div
        className="stage hero-stage"
        role="img"
        aria-label="Courseless at work: a spreadsheet of regional sales with the pointer arriving on the Insert tab, the pinned coach showing step 2 of the lesson Pivot tables in one sitting, and a short exchange with the coach beside it."
      >
        <SheetApp />
        <Ghost className="hero-ghost" label="Insert › PivotTable" />
        <div className="coachcard" aria-hidden="true">
          <p className="cc-head">
            coach <span>step 5</span>
          </p>
          <p className="cc-you">this pivot table looks weird</p>
          <p className="cc-coach">Drag Region out of Values. It landed there as a count. Put it in Rows.</p>
        </div>
        <Widget />
      </div>
    </div>
  )
}

/** A different app, a different lesson: step 4 of Auto layout that behaves, in a design tool. */
export function PointStage() {
  return (
    <div className="stage-wrap">
      <div
        className="stage point-stage"
        role="img"
        aria-label="A design tool with a card on the canvas. The pointer arrives on the Auto layout control in the right panel and names it."
      >
        <div className="mini" aria-hidden="true">
          <div className="mini-bar">
            <i />
            <i />
            <i />
            <span className="desk-file">Team page</span>
          </div>
          <div className="mini-body">
            <div className="mini-canvas">
              <div className="dcard">
                <span className="davatar" />
                <span className="dname">Jordan Lee</span>
                <span className="drole">Product Designer</span>
              </div>
            </div>
            <div className="dside">
              <p className="dsec">Design</p>
              <div className="drow">
                <span>Alignment</span>
                <span className="dbtn" />
              </div>
              <div className="drow target">
                <span>Auto layout</span>
                <span className="dbtn plus">+</span>
              </div>
              <div className="drow">
                <span>Fill</span>
                <span className="dbtn" />
              </div>
              <div className="drow">
                <span>Stroke</span>
                <span className="dbtn" />
              </div>
            </div>
          </div>
        </div>
        <Ghost className="point-ghost" label="Auto layout" />
      </div>
    </div>
  )
}
