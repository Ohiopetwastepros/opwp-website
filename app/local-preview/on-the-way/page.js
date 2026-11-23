import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getRuntimeEnv } from '@/lib/cloudflare';
import { arrivalPreviewData, isLocalArrivalPreview } from './preview-data.mjs';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: { absolute: 'Your visit is on the way | Ohio Pet Waste Pros' },
  description: 'A fabricated local preview of your Ohio Pet Waste Pros service arrival.',
  robots: { index: false, follow: false, noarchive: true },
  alternates: { canonical: null },
  openGraph: null,
  twitter: null,
};

function Icon({ name, size = 22, ...props }) {
  const paths = {
    check: <path d="m5 12 4 4L19 6" />,
    clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z" /><path d="m8 12 3 3 5-6" /></>,
    yard: <><path d="M4 20h16M6 20V9m6 11V6m6 14V9M4 13h16M4 17h16M4 9l2-3 2 3m8 0 2-3 2 3M10 6l2-3 2 3" /></>,
    litter: <><path d="M3 11h18l-2 9H5zM7 11V7a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v4M8 15h8" /></>,
    sparkle: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5zM20 3v4M18 5h4" /></>,
    bag: <><path d="M5 7h14l1 14H4zM8 7V5a4 4 0 0 1 8 0v2M9 13h6M10 17h4" /></>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    home: <><path d="m3 11 9-8 9 8M6 9v12h12V9M10 21v-7h4v7" /></>,
    paw: <><ellipse cx="12" cy="15.5" rx="5" ry="4" /><ellipse cx="5.5" cy="9" rx="2" ry="2.8" /><ellipse cx="10" cy="5.5" rx="2" ry="2.8" /><ellipse cx="15.5" cy="5.5" rx="2" ry="2.8" /><ellipse cx="19" cy="10" rx="2" ry="2.8" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}

function RouteMap({ visit }) {
  return <div className={styles.map} role="img" aria-label={`Illustrative arrival route to your ${visit.city} visit, stop ${visit.stopNumber}. This is a sample map, not live location.`}>
    <svg className={styles.mapArtwork} viewBox="0 0 660 360" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="660" height="360" fill="#ececea" />
      <path d="M0 38h165v93H0zm235-38h119v89H235zm219 0h154v83H454zM0 222h156v138H0zm236 19h140v119H236zm220-78h204v140H456z" fill="#e0e1dd" />
      <path d="M-20 180H690M195-10v390M413-10v390M0 112h660M0 327h660M300-10v190M520 112v235" stroke="#d4d4d1" strokeWidth="22" fill="none" />
      <path d="M-20 180H690M195-10v390M413-10v390M0 112h660M0 327h660M300-10v190M520 112v235" stroke="#fafaf9" strokeWidth="17" fill="none" />
      <path d="M0 278c78-34 113-4 147 45s106 45 156 37" fill="none" stroke="#d1d3cf" strokeWidth="24" />
      <g fill="#b8bbb7"><rect x="50" y="57" width="29" height="22" rx="3" /><rect x="90" y="57" width="28" height="22" rx="3" /><rect x="236" y="133" width="28" height="23" rx="3" /><rect x="335" y="133" width="32" height="23" rx="3" /><rect x="445" y="213" width="30" height="24" rx="3" /><rect x="552" y="213" width="30" height="24" rx="3" /><rect x="335" y="265" width="30" height="24" rx="3" /></g>
      <g fill="#92958f" fontFamily="system-ui, sans-serif" fontSize="10" letterSpacing="1"><text x="53" y="151">NEIGHBORHOOD PARK</text><text x="430" y="71">{visit.city.toUpperCase()}</text><text x="249" y="310">YOUR NEIGHBORHOOD</text></g>
      <path d="M117 180h183v-68h113v122h107" stroke="#bb0000" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M117 180h70" stroke="#18191c" strokeWidth="6" strokeLinecap="round" />
      <circle cx="187" cy="180" r="31" fill="#18191c" opacity=".08" />
      <circle cx="187" cy="180" r="21" fill="#fff" />
      <circle cx="187" cy="180" r="17" fill="#222326" />
      <text x="187" y="184" textAnchor="middle" fill="white" fontFamily="system-ui, sans-serif" fontWeight="700" fontSize="10">{visit.technician.initials}</text>
      <g transform="translate(520 234)"><circle r="31" fill="#bb0000" opacity=".08" /><path d="M0 11c-4-5-17-14-17-26a17 17 0 0 1 34 0C17-3 4 6 0 11Z" fill="#bb0000" stroke="#fff" strokeWidth="3" /><text x="0" y="-10" textAnchor="middle" fill="#fff" fontSize="13" fontWeight="700" fontFamily="system-ui, sans-serif">{visit.stopNumber}</text></g>
    </svg>
    <span className={styles.mapLabel}><span /> Arrival route</span>
    <div className={styles.homeLabel}><Icon name="home" size={17} /><span>Your {visit.city} visit</span></div>
    <span className={styles.mapDisclaimer}>Illustrative map</span>
  </div>;
}

export default async function OnTheWayPage({ searchParams }) {
  const requestHeaders = await headers();
  if (!isLocalArrivalPreview(getRuntimeEnv(), requestHeaders.get('host'), requestHeaders.get('x-forwarded-proto'))) notFound();
  const visit = arrivalPreviewData(await searchParams);
  if (!visit) notFound();
  return <div className={styles.page}>
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <div className={styles.brand}><span className={styles.brandMark}><Icon name="paw" size={25} /></span><span>Ohio Pet<br /><strong>Waste Pros</strong></span></div>
        <div className={styles.headerStatus}><span /> Service update</div>
      </div>
    </header>
    <div className={styles.content}>
      <div className={styles.intro}>
        <div className={styles.eyebrow}>YOUR NEXT VISIT <span /> {visit.serviceDate}</div>
        <h1>A clean yard is on the way.</h1>
        <p>Hi {visit.firstName}, we&apos;re heading to your {visit.city} visit. Your technician will take it from here.</p>
      </div>
      <div className={styles.mainGrid}>
        <section className={styles.journey} aria-labelledby="journey-title">
          <div className={styles.panelHeading}><div><span className={styles.kicker}>THE JOURNEY</span><h2 id="journey-title">Next stop, your yard.</h2></div><span className={styles.statusPill}><span /> On the way</span></div>
          <RouteMap visit={visit} />
          <ol className={styles.progress} aria-label="Visit progress">
            <li aria-current="step"><span className={styles.progressCurrent}><Icon name="arrow" size={16} /></span><strong>On the way</strong><small>Heading your way</small></li>
            <li><span>2</span><strong>Arriving soon</strong><small>Almost there</small></li>
            <li><span>3</span><strong>Yard refreshed</strong><small>Ready to enjoy</small></li>
          </ol>
        </section>
        <aside className={styles.arrival} aria-labelledby="arrival-title">
          <div className={styles.arrivalTop}><span className={styles.kicker}>ESTIMATED ARRIVAL</span><Icon name="clock" size={23} /></div>
          <h2 id="arrival-title">{visit.minutes}<span> min</span></h2>
          <p className={styles.arrivalTime}>Around {visit.arrivalTime}</p>
          <div className={styles.arrivalRule} />
          <div className={styles.technician}><span className={styles.avatar}>{visit.technician.initials}<i><Icon name="check" size={10} /></i></span><div><small>Your technician</small><strong>{visit.technician.name}</strong><span>Ohio Pet Waste Pros team</span></div></div>
          <p className={styles.arrivalNote}>Good people. A little care.<br />A yard you can enjoy again.</p>
          <a className={styles.detailsLink} href="#visit-details">View visit details <Icon name="arrow" size={17} /></a>
          <p className={styles.estimateNote}>Arrival times are estimates and may change.</p>
        </aside>
      </div>
      <div className={styles.detailsGrid} id="visit-details">
        <section className={styles.servicePanel} aria-labelledby="service-title"><div className={styles.sectionHeading}><span className={styles.kicker}>ALL TAKEN CARE OF</span><h2 id="service-title">On today&apos;s visit</h2></div><ul className={styles.services}>{visit.services.map(service => <li key={service.title}><span className={styles.serviceIcon}><Icon name={service.icon} /></span><div><strong>{service.title}</strong><span>{service.detail}</span></div><Icon name="check" size={17} /></li>)}</ul></section>
        <section className={styles.reminder} aria-labelledby="reminder-title"><div className={styles.reminderIcon}><Icon name="shield" size={24} /></div><div><span className={styles.kicker}>A QUICK REMINDER</span><h2 id="reminder-title">A safe start makes a great visit.</h2><p>Please keep dogs indoors and make sure the service gate is accessible. We&apos;ll close and check the gate when we finish.</p><div className={styles.reminderTags}><span><Icon name="check" size={13} /> Dogs indoors</span><span><Icon name="check" size={13} /> Clear access</span></div></div></section>
      </div>
      <footer className={styles.footer}><div><Icon name="paw" size={17} /><span>More time with your dogs. Less on your to-do list.</span></div><p><strong>Local preview</strong> Sample visit only. No customer message has been sent.</p></footer>
    </div>
  </div>;
}
