import MobileDemo from './MobileDemo';
export const metadata={title:'Route Partner · Mobile test drive',description:'Ohio Pet Waste Pros technician training demo with fictional customers.',robots:{index:false,follow:false},manifest:'/field-demo/manifest.webmanifest',appleWebApp:{capable:true,title:'OPWP Route Partner',statusBarStyle:'default'},alternates:{canonical:'/field-demo/'},icons:{icon:'/field-demo/icon.svg',apple:'/field-demo/icon-192.png'}};
export const viewport={width:'device-width',initialScale:1,viewportFit:'cover',themeColor:'#14304a'};
export default function Page(){return <MobileDemo/>;}
