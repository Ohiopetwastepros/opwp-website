// City data for the dynamic [citySlug] route. One entry per *.dc.html that
// imported "City Page". `slug` is the canonical path segment (no slashes).
export const cities = [
  { slug: "dog-poop-removal-toledo-oh", city: "Toledo", state: "Ohio", stateAbbr: "OH", zips: "43604, 43605, 43606, 43607, 43608, 43609, 43610, 43611, 43612, 43613, 43614, 43615, 43617, 43620, 43623, 43601", lat: 41.6528, lng: -83.5379 },
  { slug: "dog-poop-removal-sylvania-oh", city: "Sylvania", state: "Ohio", stateAbbr: "OH", zips: "43560", lat: 41.7189, lng: -83.7138 },
  { slug: "dog-poop-removal-perrysburg-oh", city: "Perrysburg", state: "Ohio", stateAbbr: "OH", zips: "43551, 43552", lat: 41.557, lng: -83.6272 },
  { slug: "dog-poop-removal-maumee-oh", city: "Maumee", state: "Ohio", stateAbbr: "OH", zips: "43537", lat: 41.563, lng: -83.6539 },
  { slug: "dog-poop-removal-holland-oh", city: "Holland", state: "Ohio", stateAbbr: "OH", zips: "43528", lat: 41.6217, lng: -83.7141 },
  { slug: "dog-poop-removal-oregon-oh", city: "Oregon", state: "Ohio", stateAbbr: "OH", zips: "43616", lat: 41.6434, lng: -83.4869 },
  { slug: "dog-poop-removal-whitehouse-oh", city: "Whitehouse", state: "Ohio", stateAbbr: "OH", zips: "43571", lat: 41.5187, lng: -83.8088 },
  { slug: "dog-poop-removal-waterville-oh", city: "Waterville", state: "Ohio", stateAbbr: "OH", zips: "43566", lat: 41.5006, lng: -83.718 },
  { slug: "dog-poop-removal-rossford-oh", city: "Rossford", state: "Ohio", stateAbbr: "OH", zips: "43460", lat: 41.5895, lng: -83.5644 },
  { slug: "dog-poop-removal-bowling-green-oh", city: "Bowling Green", state: "Ohio", stateAbbr: "OH", zips: "43402, 43403", lat: 41.3748, lng: -83.6513 },
  { slug: "dog-poop-removal-monclova-oh", city: "Monclova", state: "Ohio", stateAbbr: "OH", zips: "43542", lat: 41.5556, lng: -83.7438 },
  { slug: "dog-poop-removal-northwood-oh", city: "Northwood", state: "Ohio", stateAbbr: "OH", zips: "43619", lat: 41.6131, lng: -83.4905 },
  { slug: "dog-poop-removal-berkey-oh", city: "Berkey", state: "Ohio", stateAbbr: "OH", zips: "43504", lat: 41.7261, lng: -83.8463 },
  { slug: "dog-poop-removal-haskins-oh", city: "Haskins", state: "Ohio", stateAbbr: "OH", zips: "43525", lat: 41.4634, lng: -83.7019 },
  { slug: "dog-poop-removal-curtice-oh", city: "Curtice", state: "Ohio", stateAbbr: "OH", zips: "43412", lat: 41.6231, lng: -83.3702 },
  { slug: "dog-poop-removal-delta-oh", city: "Delta", state: "Ohio", stateAbbr: "OH", zips: "43515", lat: 41.5734, lng: -84.0066 },
  { slug: "dog-poop-removal-dunbridge-oh", city: "Dunbridge", state: "Ohio", stateAbbr: "OH", zips: "43414", lat: 41.4181, lng: -83.5763 },
  { slug: "dog-poop-removal-genoa-oh", city: "Genoa", state: "Ohio", stateAbbr: "OH", zips: "43416", lat: 41.5183, lng: -83.3585 },
  { slug: "dog-poop-removal-neapolis-oh", city: "Neapolis", state: "Ohio", stateAbbr: "OH", zips: "43547", lat: 41.4561, lng: -83.8488 },
  { slug: "dog-poop-removal-tontogany-oh", city: "Tontogany", state: "Ohio", stateAbbr: "OH", zips: "43565", lat: 41.4267, lng: -83.7544 },
  { slug: "dog-poop-removal-walbridge-oh", city: "Walbridge", state: "Ohio", stateAbbr: "OH", zips: "43465", lat: 41.587, lng: -83.5022 },
  { slug: "dog-poop-removal-swanton-oh", city: "Swanton", state: "Ohio", stateAbbr: "OH", zips: "43558", lat: 41.587, lng: -83.891 },
  { slug: "dog-poop-removal-temperance-mi", city: "Temperance", state: "Michigan", stateAbbr: "MI", zips: "48182", lat: 41.777, lng: -83.5694 },
  { slug: "dog-poop-removal-lambertville-mi", city: "Lambertville", state: "Michigan", stateAbbr: "MI", zips: "48144", lat: 41.7536, lng: -83.6266 },
  { slug: "dog-poop-removal-ottawa-lake-mi", city: "Ottawa Lake", state: "Michigan", stateAbbr: "MI", zips: "49267", lat: 41.8011, lng: -83.7202 },
];

export function getCity(slug) {
  return cities.find((c) => c.slug === slug);
}
