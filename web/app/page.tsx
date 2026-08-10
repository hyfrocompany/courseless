import { Cover } from '@/components/Cover'
import { DL_MAC, DL_WIN, Footer, Topbar } from '@/components/chrome'
import { DownloadIcon, SearchIcon, ShareIcon } from '@/components/icons'
import { HeroStage, PointStage } from '@/components/mocks'
import { FEATURED, MORE } from '@/lib/lessons'

// The order is the information, so the list is ordered once and numbered once.
const STEPS = [
  {
    h: 'Say what you want to be able to do',
    p: 'Pick how much you have done before, then Teach me.'
  },
  {
    h: 'A lesson arrives in about 40 seconds',
    p: '8 to 12 steps, each with a checkpoint you can see with your own eyes.'
  },
  {
    h: 'The window steps aside',
    p: 'The coach pins over your work while you do the real task. Esc brings the window back.'
  },
  {
    h: 'You are measured by help needed',
    p: 'Assistance rate is hints plus twice any skips, per step. Run it again and watch it fall.'
  }
]

const KEYS = [
  { k: 'Space', what: 'Did it', where: 'Go to the next step' },
  { k: 'H', what: 'Hint', where: 'Three levels, counted' },
  { k: 'P', what: 'Show me', where: 'Point at it on screen' },
  { k: 'C', what: 'Coach', where: 'Chat about this step' },
  { k: 'S', what: 'Skip', where: 'Move on, counted twice' },
  { k: 'Esc', what: 'Back', where: 'Return to the window' }
]

const MARKS = [
  ['00:12', 'Open the close checklist for the accounting period'],
  ['04:38', 'Run the A/R Aging Summary as of the period-end date'],
  ['09:05', 'Reconcile each period-end bank statement'],
  ['14:21', 'Lock accounts receivable for the target period']
]

export default function Home() {
  return (
    <>
      <Topbar />

      <main id="main">
        {/* ------------------------------------------------------ hero */}
        <section className="hero">
          <div className="wrap hero-grid">
            <div>
              <h1>
                Stop taking courses.<span className="soft">Start doing things.</span>
              </h1>
              <p className="lede">
                Say what you want to be able to do. Courseless writes the steps, pins a small coach over your work,
                and shows you where to click next in the app you are actually using.
              </p>
              <div className="downloads" id="downloads">
                <a className="btn dl" id="dl-mac" href={DL_MAC}>
                  <DownloadIcon size={16} />
                  Download for macOS
                </a>
                <a className="btn dl" id="dl-win" href={DL_WIN}>
                  <DownloadIcon size={16} />
                  Download for Windows
                </a>
              </div>
            </div>
            <HeroStage />
          </div>
        </section>

        {/* ------------------------------------------------------ how */}
        <section className="section" id="how">
          <div className="wrap">
            <div className="section-head">
              <h2 className="h2">Four steps between asking and having done it.</h2>
              <p className="sub">
                Nothing is recorded in advance. The lesson is written when you ask for it, which is why it can be
                about the tool your company uses and still be current.
              </p>
            </div>
            <ol className="steps">
              {STEPS.map((s, i) => (
                <li className="step" key={s.h}>
                  <span className="step-n" aria-hidden="true">
                    {i + 1}
                  </span>
                  <h3>{s.h}</h3>
                  <p>{s.p}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ------------------------------------------------------ in the app */}
        <section className="section" id="doing">
          <div className="wrap">
            <div className="section-head">
              <h2 className="h2">Guidance, not agency.</h2>
              <p className="sub">
                When an agent does the task for you, the skill stays with the machine. Courseless stops one step
                short of that, on purpose.
              </p>
            </div>

            <div className="feature">
              <div>
                <h3>It points. It never clicks for you.</h3>
                <p>
                  Press <kbd>P</kbd>. A ghost cursor flies across your screen to the element the step names, settles
                  on it with a ripple, and says what it found.
                </p>
                <p className="honest">
                  <SearchIcon size={14} />
                  <span>
                    When it cannot find the target it says so: “Nothing to point at on this step. It happens at the
                    terminal prompt.” It never points at a guess.
                  </span>
                </p>
              </div>
              <div className="feature-art">
                <PointStage />
              </div>
            </div>

            <div className="feature flip">
              <div className="feature-art">
                <div className="chatcard">
                  <p className="chat-head">
                    coach <span>step 2</span>
                  </p>
                  <p className="bubble you">claude --version says it is not recognised</p>
                  <p className="bubble coach">
                    The install landed after this terminal opened, so it has the old PATH. Close Windows Terminal,
                    open it again, then run claude --version once more.
                  </p>
                  <div className="chat-input">
                    <span className="fake">What are you seeing?</span>
                    <span className="ask">Ask</span>
                  </div>
                </div>
              </div>
              <div>
                <h3>A coach that knows the step you are on.</h3>
                <p>
                  Press <kbd>C</kbd>. The chat already has your lesson and your current step, and it is the same
                  conversation in the widget and in the window.
                </p>
                <p className="note">
                  Hints come in three levels and are counted honestly. Practice mode locks them until you have
                  genuinely tried twice.
                </p>
              </div>
            </div>

            <div className="feature">
              <div>
                <h3>Record what you already know.</h3>
                <p>
                  Work through your own process and mark each moment with <kbd>Ctrl</kbd> <kbd>Shift</kbd>{' '}
                  <kbd>M</kbd>. Your coach compiles the marks into a lesson written for whoever you name, and you can
                  edit the steps before you share.
                </p>
                <p className="note">
                  Export it as a file. A colleague imports it and runs it, with pointing working on their machine.
                </p>
              </div>
              <div className="feature-art">
                <div className="marks">
                  {MARKS.map(([t, label]) => (
                    <p className="mark-row" key={t}>
                      <span className="d" />
                      <span className="t">{t}</span>
                      {label}
                    </p>
                  ))}
                </div>
                <div className="filecard">
                  <ShareIcon size={16} />
                  <span className="name">close-the-month.courseless.json</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------ keys */}
        <section className="section" id="keys">
          <div className="wrap">
            <div className="section-head">
              <h2 className="h2">Every lesson is completable without a mouse.</h2>
              <p className="sub">
                The widget never takes focus, so your typing keeps landing in the app you are learning. Click it
                once, and these are the whole interface.
              </p>
            </div>
            <ul className="keys">
              {KEYS.map((k) => (
                <li className="key" key={k.k}>
                  <kbd>{k.k}</kbd>
                  <p className="what">{k.what}</p>
                  <p className="where">{k.where}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ------------------------------------------------------ library */}
        <section className="section" id="library">
          <div className="wrap">
            <div className="section-head">
              <h2 className="h2">Twenty seven lessons are there on first run.</h2>
              <p className="sub">
                A starter library across ten tracks, so the first screen is never empty. Delete the ones you do not
                need, or ask for something of your own.
              </p>
            </div>

            <ul className="covers">
              {FEATURED.map((l) => (
                <li className="covercard" key={l.title}>
                  <Cover seed={l.seed}>
                    <span className="cover-tool">{l.short}</span>
                    <span className="cover-min">{l.minutes} min</span>
                  </Cover>
                  <p className="cname">{l.title}</p>
                  <p className="cmeta">
                    <span className="tag">Starter</span>
                    {l.steps} steps
                  </p>
                </li>
              ))}
            </ul>

            <ul className="lrows">
              {MORE.map((l) => (
                <li className="lrow" key={l.title}>
                  <Cover seed={l.seed} className="lthumb" />
                  <span className="ltitle">{l.title}</span>
                  <span className="ltool">{l.tool}</span>
                  <span className="lmin">{l.minutes} min</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ------------------------------------------------------ pricing */}
        <section className="section" id="pricing">
          <div className="wrap">
            <div className="section-head">
              <h2 className="h2">Plans are counted in lessons.</h2>
              <p className="sub">
                Start free. Move up when you run out of lessons, not when a feature is held back.
              </p>
            </div>
            <table className="pricing">
              <thead>
                <tr>
                  <th scope="col">Plan</th>
                  <th scope="col">Lessons</th>
                  <th scope="col">What you get</th>
                  <th scope="col">Price</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Free</th>
                  <td>3 a month</td>
                  <td>The starter library, the pinned widget, checkpoints and the review.</td>
                  <td className="price">$0</td>
                </tr>
                <tr>
                  <th scope="row">Pro</th>
                  <td>150 a month</td>
                  <td>Everything in Free, plus the full coach and on-screen pointing.</td>
                  <td className="price">
                    $20 / month<span>or $192 a year</span>
                  </td>
                </tr>
                <tr>
                  <th scope="row">Max</th>
                  <td>Unlimited</td>
                  <td>Everything in Pro, without the monthly ceiling. Fair use applies.</td>
                  <td className="price">
                    $50 / month<span>or $480 a year</span>
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="fineprint">You choose a plan inside the app.</p>
          </div>
        </section>

        {/* ------------------------------------------------------ closer */}
        <section className="closer" id="get">
          <div className="wrap closer-in">
            <div>
              <h2 className="h2">Pick the thing you have been putting off.</h2>
              <p className="sub">Free for three lessons a month. No account needed to install it.</p>
            </div>
            <div className="downloads">
              <a className="btn primary" href={DL_MAC}>
                Download for macOS
              </a>
              <a className="btn" href={DL_WIN}>
                Download for Windows
              </a>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </>
  )
}
