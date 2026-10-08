-- 017 — The brands each standards set covers.
--
-- A set's `brand_names` now decides, alone, which hotels' reviews read it. An
-- admin edits the list on the Standards screen. Until now each list held one
-- name and the code grouped a brand's lines by family.
--
-- This fills the two existing lists with the lines the code had grouped under
-- them. It is a starting point from the app's built-in list, not a statement
-- of what CD's agreements cover.
--
-- Apply before deploying the code that reads the lists this way. It is safe
-- while older code is live, which matches any listed name. Each update runs
-- only where a list still holds its one original name, so applying it twice,
-- or after an admin's edit, changes nothing.

update standard_sets
set brand_names = array[
  'Hilton',
  'Waldorf Astoria',
  'Conrad',
  'Signia by Hilton',
  'Curio Collection by Hilton',
  'Tapestry Collection by Hilton',
  'DoubleTree by Hilton',
  'Embassy Suites',
  'Hilton Garden Inn',
  'Hampton Inn',
  'Homewood Suites',
  'Home2 Suites',
  'Canopy by Hilton',
  'Tru by Hilton',
  'Hilton Grand Vacations'
]
where key = 'hilton' and brand_names = array['Hilton'];

update standard_sets
set brand_names = array[
  'Hyatt',
  'Park Hyatt',
  'Grand Hyatt',
  'Hyatt Regency',
  'Hyatt Centric',
  'Hyatt Place',
  'Hyatt House',
  'Andaz',
  'Thompson',
  'Alila',
  'Miraval'
]
where key = 'hyatt' and brand_names = array['Hyatt'];
