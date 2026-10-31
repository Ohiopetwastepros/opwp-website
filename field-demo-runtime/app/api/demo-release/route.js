import release from '@/lib/demo-release.json';
export function GET(){return Response.json(release,{headers:{'Cache-Control':'no-store'}});}
