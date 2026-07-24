// Country name → region grouping for the leagues index page. There's no
// region/continent column in the warehouse, so this is a static lookup —
// classification of data already fetched, not a new data source.

export const REGIONS = ["Europe", "South America", "North America", "Africa", "Asia", "Other"] as const;
export type Region = (typeof REGIONS)[number];

const EUROPE = [
  "England", "Spain", "Italy", "Germany", "France", "Portugal", "Netherlands",
  "Belgium", "Scotland", "Turkey", "Russia", "Ukraine", "Greece", "Switzerland",
  "Austria", "Denmark", "Sweden", "Norway", "Poland", "Czech Republic", "Croatia",
  "Serbia", "Romania", "Hungary", "Ireland", "Wales", "Northern Ireland", "Iceland",
  "Finland", "Bulgaria", "Slovakia", "Slovenia", "Bosnia and Herzegovina", "Cyprus",
  "Israel", "Albania", "North Macedonia", "Montenegro", "Georgia", "Kazakhstan",
  "Azerbaijan", "Armenia", "Luxembourg", "Malta", "Moldova", "Belarus", "Kosovo",
  "Estonia", "Latvia", "Lithuania", "Andorra", "San Marino", "Faroe Islands",
  "Gibraltar", "Liechtenstein", "Monaco", "Europe",
];
const SOUTH_AMERICA = [
  "Brazil", "Argentina", "Uruguay", "Chile", "Colombia", "Peru", "Ecuador",
  "Paraguay", "Bolivia", "Venezuela", "South America",
];
const NORTH_AMERICA = [
  "United States", "USA", "Mexico", "Canada", "Costa Rica", "Honduras",
  "Jamaica", "Panama", "Guatemala", "El Salvador", "Trinidad and Tobago",
  "Nicaragua", "Haiti", "Cuba", "Dominican Republic", "North America",
  "Central America", "Caribbean",
];
const AFRICA = [
  "Nigeria", "Egypt", "South Africa", "Morocco", "Algeria", "Tunisia", "Ghana",
  "Senegal", "Cameroon", "Ivory Coast", "Côte d'Ivoire", "Kenya", "Zambia",
  "Uganda", "Tanzania", "DR Congo", "Congo", "Mali", "Angola", "Ethiopia",
  "Rwanda", "Sudan", "Libya", "Zimbabwe", "Mozambique", "Africa",
];
const ASIA = [
  "Japan", "South Korea", "China", "Saudi Arabia", "Qatar", "United Arab Emirates",
  "Iran", "Iraq", "India", "Indonesia", "Thailand", "Vietnam", "Malaysia",
  "Singapore", "Australia", "New Zealand", "Uzbekistan", "Jordan", "Bahrain",
  "Kuwait", "Oman", "Syria", "Lebanon", "Myanmar", "Philippines", "Hong Kong",
  "Taiwan", "Asia", "Oceania",
];

function buildIndex(names: string[]): Set<string> {
  return new Set(names.map((n) => n.toLowerCase()));
}
const IDX: Record<Exclude<Region, "Other">, Set<string>> = {
  Europe: buildIndex(EUROPE),
  "South America": buildIndex(SOUTH_AMERICA),
  "North America": buildIndex(NORTH_AMERICA),
  Africa: buildIndex(AFRICA),
  Asia: buildIndex(ASIA),
};

export function regionOf(country: string | null | undefined): Region {
  if (!country) return "Other";
  const c = country.toLowerCase();
  for (const region of Object.keys(IDX) as Exclude<Region, "Other">[]) {
    if (IDX[region].has(c)) return region;
  }
  return "Other";
}
