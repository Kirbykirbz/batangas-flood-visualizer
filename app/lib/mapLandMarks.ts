// app/lib/mapLandMarks.ts

export type LandmarkCategory =
  | "mall"
  | "school"
  | "government"
  | "subdivision"
  | "stadium"
  | "market"
  | "district"
  | "monument"
  | "general";

export type MapLandmark = {
  id: string;
  name: string;
  description?: string | null;
  lat: number;
  lng: number;
  category: LandmarkCategory;
};

export const HARD_CODED_LANDMARKS: MapLandmark[] = [
  {
    id: "lm-sm-batangas",
    name: "SM Batangas",
    lat: 13.755575896174822,
    lng: 121.06852650491314,
    category: "mall",
  },
  {
    id: "lm-libjo-elem-school",
    name: "Libjo Elementary School",
    lat: 13.744514816353272,
    lng: 121.07151829987103,
    category: "school",
  },
  {
    id: "lm-libjo-barangay-hall",
    name: "Libjo Barangay Hall",
    lat: 13.7448122591365,
    lng: 121.07199037575265,
    category: "government",
  },
  {
    id: "lm-tierra-verde-subdivision",
    name: "Tierra Verde Subdivision",
    lat: 13.75083103178261,
    lng: 121.07138085981994,
    category: "subdivision",
  },
  {
    id: "lm-barangay-20-hall",
    name: "Barangay 20 Barangay Hall",
    lat: 13.75259796235184,
    lng: 121.05263506533265,
    category: "government",
  },
  {
    id: "lm-batangas-city-stadium",
    name: "Batangas City Stadium",
    lat: 13.753661010213214,
    lng: 121.05138292724725,
    category: "stadium",
  },
  {
    id: "lm-batangas-old-market",
    name: "Batangas Old Market",
    lat: 13.757028783161033,
    lng: 121.05508929615426,
    category: "market",
  },
  {
    id: "lm-new-batangas-city-public-market",
    name: "New Batangas City Public Market",
    lat: 13.749916655028235,
    lng: 121.05564315696758,
    category: "market",
  },
  {
    id: "lm-bay-city-mall",
    name: "Bay City Mall",
    lat: 13.758576312122043,
    lng: 121.05715947185867,
    category: "mall",
  },
  {
    id: "lm-hilltop",
    name: "Hilltop",
    lat: 13.764685032961166,
    lng: 121.06085678813298,
    category: "district",
  },
  {
    id: "lm-welcome-monument",
    name: "Welcome to Batangas City Monument",
    lat: 13.77089789166519,
    lng: 121.06550273127888,
    category: "monument",
  },
];