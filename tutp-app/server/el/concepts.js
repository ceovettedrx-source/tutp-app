// The 12 pilot concepts of Guided Discovery (experiential-learning-v2).
// One place for: the concept's id, its aliases (typed-topic matching), the
// PhET sims, the official NCERT mapping and the misconception used for the
// wrong "predict" option. scripts/el/build-kg.mjs turns this into the
// knowledge-graph records; scripts/el/generate.mjs into the lesson JSON.
//
// NCERT mappings below were read from the official ncert.nic.in contents
// pages and chapter PDFs (2026-10-05, reprint 2026-27 editions); the topic
// of each concept was found inside the named chapter. Telangana (SCERT) is
// not here on purpose: its site was unreachable, so every Telangana mapping
// is written as a placeholder with no chapter (never guessed).

const PDF = (code) => `https://ncert.nic.in/textbook/pdf/${code}.pdf`;

export const PHET = (slug) => `https://phet.colorado.edu/sims/html/${slug}/latest/${slug}_all.html`;

export const CONCEPTS = [
  {
    id: 'separation', title: 'Separation of substances', grade: 6,
    aliases: ['separation', 'separating', 'filtration', 'filter', 'sieving', 'evaporation', 'decantation', 'mixture', 'winnowing'],
    phet: [],
    lo: 'Chooses and explains a way (sieving, filtering, evaporating) to separate a mixture, based on what is different about its parts',
    misconception: 'Believes anything mixed in water can be filtered out, including salt that has dissolved',
    ncert: { grade: 6, chapter: 9, title: 'Methods of Separation in Everyday Life', url: PDF('fecu109') },
  },
  {
    id: 'shadows', title: 'Light and shadows', grade: 7,
    aliases: ['shadow', 'shadows', 'light and shadow', 'opaque', 'translucent', 'transparent', 'umbra', 'eclipse'],
    phet: [],
    lo: 'Explains that a shadow forms when an opaque object blocks light travelling in straight lines, and how its size changes with distances',
    misconception: 'Believes the shadow gets smaller when the object moves closer to the light',
    ncert: { grade: 7, chapter: 11, title: 'Light: Shadows and Reflections', url: PDF('gecu111') },
  },
  {
    id: 'magnets', title: 'Magnets', grade: 6,
    aliases: ['magnet', 'magnets', 'magnetic', 'poles', 'north pole', 'south pole', 'attract', 'repel'],
    phet: [],
    lo: 'Predicts which materials a magnet attracts and how two magnets act on each other (like poles repel, unlike poles attract)',
    misconception: 'Believes a magnet attracts every metal, or that a magnet is strongest in its middle',
    ncert: { grade: 6, chapter: 4, title: 'Exploring Magnets', url: PDF('fecu104') },
  },
  {
    id: 'circuit', title: 'A simple electric circuit', grade: 7,
    aliases: ['circuit', 'electric circuit', 'electricity', 'bulb', 'battery', 'cell', 'switch', 'conductor', 'insulator', 'current'],
    phet: ['circuit-construction-kit-dc'],
    lo: 'Builds and explains a complete circuit in which a cell, a switch and a bulb form a closed loop for current to flow',
    misconception: 'Believes a bulb lights with only one wire from the cell, because the current is "used up" at the bulb',
    ncert: { grade: 7, chapter: 3, title: 'Electricity: Circuits and their Components', url: PDF('gecu103') },
  },
  {
    id: 'acids-bases', title: 'Acids, bases and indicators', grade: 7,
    aliases: ['acid', 'acids', 'base', 'bases', 'alkali', 'indicator', 'indicators', 'litmus', 'neutral', 'ph', 'turmeric', 'neutralisation'],
    phet: ['acid-base-solutions'],
    lo: 'Classifies everyday substances as acidic, basic or neutral using an indicator and explains what the colour change shows',
    misconception: 'Believes all sour things are dangerous acids and all soapy things are harmless, so a colour change cannot tell them apart',
    ncert: { grade: 7, chapter: 2, title: 'Exploring Substances: Acidic, Basic, and Neutral', url: PDF('gecu102') },
  },
  {
    id: 'heat-transfer', title: 'How heat travels', grade: 7,
    aliases: ['heat', 'heat transfer', 'conduction', 'convection', 'radiation', 'conductor of heat', 'hot', 'temperature'],
    phet: ['energy-forms-and-changes'],
    lo: 'Explains that heat flows from hotter to colder things and tells conduction, convection and radiation apart in everyday examples',
    misconception: 'Believes metal spoons feel cold because they hold cold, not because they carry heat away from the hand faster',
    ncert: { grade: 7, chapter: 7, title: 'Heat Transfer in Nature', url: PDF('gecu107') },
  },
  {
    id: 'force-pressure', title: 'Force and pressure', grade: 8,
    aliases: ['pressure', 'force and pressure', 'force', 'atmospheric pressure', 'area', 'thumb pin', 'sharp edge'],
    phet: ['forces-and-motion-basics'],
    lo: 'Explains that the same force gives more pressure on a smaller area, and gives everyday examples',
    misconception: 'Believes pressure depends only on how hard you push, not on the area you push over',
    ncert: { grade: 8, chapter: 6, title: 'Pressure, Winds, Storms, and Cyclones', url: PDF('hecu106') },
  },
  {
    id: 'friction', title: 'Friction', grade: 8,
    aliases: ['friction', 'rough', 'smooth', 'sliding', 'rolling friction', 'lubricant', 'grip'],
    phet: ['friction'],
    lo: 'Explains that friction is a force that opposes sliding, depends on the two surfaces, and compares smooth and rough surfaces',
    misconception: 'Believes friction only exists on rough surfaces and a smooth surface has none',
    ncert: { grade: 8, chapter: 5, title: 'Exploring Forces', url: PDF('hecu105') },
  },
  {
    id: 'sound', title: 'Sound and vibration', grade: 9,
    aliases: ['sound', 'vibration', 'vibrate', 'pitch', 'frequency', 'amplitude', 'loudness', 'wave', 'echo'],
    phet: ['sound-waves'],
    lo: 'Explains that sound is made by vibrating objects, that pitch depends on frequency and loudness on amplitude',
    misconception: 'Believes a louder sound is also a higher pitch, and that sound can travel through empty space',
    ncert: { grade: 9, chapter: 10, title: 'Sound Waves: Characteristics and Applications', url: PDF('iesc110') },
  },
  {
    id: 'density-floating', title: 'Density and floating', grade: 8,
    aliases: ['density', 'floating', 'float', 'sink', 'sinking', 'buoyancy', 'buoyant', 'upthrust', 'archimedes', 'floats'],
    phet: ['buoyancy', 'density'],
    lo: 'Predicts whether an object floats or sinks using the upward push of the liquid and the density of the object compared with the liquid',
    misconception: 'Believes heavy things always sink and light things always float, whatever their size and shape',
    ncert: { grade: 8, chapter: 5, title: 'Exploring Forces', url: PDF('hecu105') },
  },
  {
    id: 'inertia', title: "Inertia (Newton's first law)", grade: 9,
    aliases: ['inertia', 'newton', 'first law', "newton's first law", 'law of inertia', 'laws of motion', 'rest', 'motion'],
    phet: ['forces-and-motion-basics'],
    lo: 'Explains that an object keeps its state of rest or steady motion unless a net force acts, and uses it for everyday examples',
    misconception: 'Believes a moving object needs a continuing push to keep moving, and stops by itself when the push ends',
    ncert: { grade: 9, chapter: 6, title: 'How Forces Affect Motion', url: PDF('iesc106') },
  },
  {
    id: 'refraction', title: 'Refraction of light', grade: 10,
    aliases: ['refraction', 'refract', 'bending of light', 'snell', 'refractive index', 'lens', 'light bends', 'apparent depth'],
    phet: ['bending-light'],
    lo: 'Explains that light bends when it passes from one transparent material to another, and uses it to explain a pencil that looks bent in water',
    misconception: 'Believes a pencil in water really bends, or that light speeds up and bends away when it enters water',
    ncert: { grade: 10, chapter: 9, title: 'Light – Reflection and Refraction', url: PDF('jesc109') },
  },
];

export const CONCEPT_IDS = CONCEPTS.map((c) => c.id);
export const getConcept = (id) => CONCEPTS.find((c) => c.id === id) || null;
export const BOARDS = ['cbse-ncert', 'telangana'];
