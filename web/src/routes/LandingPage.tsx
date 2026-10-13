import { Link } from 'react-router-dom'

const steps = [
  {
    number: '01',
    status: 'Available now',
    title: 'Create your workspace',
    text: 'Set up your private-beta account and keep access to your interview workspace in one place.',
  },
  {
    number: '02',
    status: 'Coming next',
    title: 'Prepare your context',
    text: 'Bring together your resume, the role, and the guidance you want available for each interview.',
  },
  {
    number: '03',
    status: 'Planned',
    title: 'Connect the companion',
    text: 'Hand off a prepared session to the lightweight Windows companion for the live experience.',
  },
]

export function LandingPage() {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow"><span className="status-dot" /> Private beta</span>
          <h1>Interview support, <span>organized around you.</span></h1>
          <p className="hero-description">
            Prepare in a focused web workspace, then connect a lightweight Windows companion when it is time for the conversation.
          </p>
          <div className="hero-actions">
            <Link className="button" to="/register">Create your account</Link>
            <Link className="text-link" to="/login">Already have an account? <span aria-hidden="true">→</span></Link>
          </div>
          <div className="hero-meta" aria-label="Product availability">
            <span><i aria-hidden="true">✓</i> Secure account access</span>
            <span><i aria-hidden="true">✓</i> Private-beta workspace</span>
          </div>
        </div>

        <div className="product-preview" aria-label="Floating Assistant workspace preview">
          <div className="preview-window-bar">
            <span className="window-dots" aria-hidden="true"><i /><i /><i /></span>
            <span>Workspace overview</span>
            <span className="preview-badge">Private beta</span>
          </div>
          <div className="preview-body">
            <aside aria-hidden="true">
              <div className="preview-brand"><span className="brand-mark">FA</span><b>Floating Assistant</b></div>
              <nav>
                <span className="is-current"><i /> Overview</span>
                <span><i /> Profiles</span>
                <span><i /> Interviews</span>
                <span><i /> History</span>
              </nav>
              <small>Workspace preview</small>
            </aside>
            <div className="preview-content">
              <div className="preview-heading">
                <div><small>GOOD MORNING</small><strong>Your interview workspace</strong></div>
                <span className="account-chip"><i /> Account ready</span>
              </div>
              <div className="preview-summary">
                <article className="featured-preview-card">
                  <span className="preview-icon" aria-hidden="true">01</span>
                  <div><small>GET STARTED</small><strong>Build your first interview profile</strong><p>Resume, role context, and personal guidance in one reusable setup.</p></div>
                  <span className="coming-label">Coming next</span>
                </article>
                <div className="preview-stat-grid">
                  <article><small>ACCOUNT</small><strong>Active</strong><span className="mini-line full" /></article>
                  <article><small>EMAIL</small><strong>Verification</strong><span className="mini-line medium" /></article>
                </div>
              </div>
              <div className="preview-section-title"><strong>Workspace</strong><span>Product roadmap</span></div>
              <div className="preview-rows">
                <div><span><i className="row-icon" /> Candidate profiles</span><small>Next</small></div>
                <div><span><i className="row-icon alternate" /> Interview history</span><small>Planned</small></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="product-strip" aria-label="Product structure">
        <span>Web workspace</span><i />
        <span>Secure account access</span><i />
        <span>Windows companion planned</span>
      </section>

      <section className="section how-section" id="how-it-works">
        <div className="section-heading centered-heading">
          <span className="eyebrow">How it works</span>
          <h2>A focused path from preparation to interview.</h2>
          <p>The product is being delivered in clear stages. Account access is ready today; workspace and companion features follow.</p>
        </div>
        <div className="step-grid">
          {steps.map((step) => (
            <article className="step-card" key={step.number}>
              <div className="step-card-top"><span>{step.number}</span><small>{step.status}</small></div>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section split-section">
        <div className="split-copy">
          <span className="eyebrow">One connected product</span>
          <h2>A workspace for planning. A companion for the live moment.</h2>
          <p>Each experience has a clear role, keeping account management in the browser and native Windows capabilities in the companion.</p>
        </div>
        <div className="responsibility-list">
          <article>
            <span className="role-icon" aria-hidden="true">W</span>
            <div><h3>Web workspace</h3><p>Account access is available now. Profiles, preparation, and history are the next website milestones.</p></div>
          </article>
          <article>
            <span className="role-icon companion" aria-hidden="true">C</span>
            <div><h3>Windows companion</h3><p>The existing native interview experience will connect to prepared website sessions in a later phase.</p></div>
          </article>
        </div>
      </section>

      <section className="cta-section">
        <div>
          <span className="eyebrow">Private beta</span>
          <h2>Start with your interview workspace.</h2>
          <p>Create an account today and follow the product as each focused capability becomes available.</p>
        </div>
        <Link className="button" to="/register">Create your account</Link>
      </section>
    </>
  )
}
