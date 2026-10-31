import { Bricolage_Grotesque, Hanken_Grotesk } from 'next/font/google';
import './globals.css';
const headline=Bricolage_Grotesque({subsets:['latin'],weight:['400','500','600','700','800'],variable:'--font-bricolage',display:'swap'});
const body=Hanken_Grotesk({subsets:['latin'],weight:['400','500','600','700','800'],variable:'--font-hanken',display:'swap'});
export const metadata={metadataBase:new URL('https://opwp-field-demo.ohiopetwastepros.workers.dev'),title:'OPWP Route Partner · Test drive',robots:{index:false,follow:false}};
export default function Layout({children}){return <html lang="en" className={`${headline.variable} ${body.variable}`}><body>{children}</body></html>;}
