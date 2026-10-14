/**
 * The CPU opponent pool: ~100 list concepts in the shorthand a competitive
 * overview article would use ("MSU Eldar", "Gaunt Carpet", "Defiler Spam"),
 * gathered from 10th-edition tournament coverage and mapped onto the
 * dataset's detachments. Names are community jargon — no rules content. The
 * detachment pin is what makes a generated team legal: it determines which
 * Force Disposition the archetype can field.
 *
 * Every entry is integrity-tested against the embedded dataset (faction
 * resolves, detachment resolves within the faction), so a stale id fails CI
 * rather than silently producing an unusable CPU player.
 */
import type { Archetype } from "./archetypes";

export const ARCHETYPE_POOL: Archetype[] = [
  // ── Aeldari ────────────────────────────────────────────────────────────────
  { id: "msu-eldar", name: "MSU Eldar", factionId: "aeldari", detachmentId: "warhost" },
  { id: "ynnead-eldar", name: "Ynnead Eldar", factionId: "aeldari", detachmentId: "devoted-of-ynnead" },
  { id: "wraithknight-spam", name: "Wraithknight Spam", factionId: "aeldari", detachmentId: "spirit-conclave" },
  { id: "seer-council-guns", name: "Seer Council Guns", factionId: "aeldari", detachmentId: "seer-council" },
  { id: "aspect-host-msu", name: "Aspect Waves", factionId: "aeldari", detachmentId: "aspect-host" },
  { id: "windrider-jetbikes", name: "Jetbike Host", factionId: "aeldari", detachmentId: "windrider-host" },
  { id: "webway-clowns", name: "Webway Clowns", factionId: "aeldari", detachmentId: "ghosts-of-the-webway" },
  { id: "corsair-skyraiders", name: "Corsair Skyraiders", factionId: "aeldari", detachmentId: "corsair-coterie" },
  { id: "falcon-shell-game", name: "Falcon Shell Game", factionId: "aeldari", detachmentId: "armoured-warhost" },

  // ── Drukhari ───────────────────────────────────────────────────────────────
  { id: "skysplinter-gunboats", name: "Skysplinter Gunboats", factionId: "drukhari", detachmentId: "skysplinter-assault" },
  { id: "coven-pain-engines", name: "Coven Pain Engines", factionId: "drukhari", detachmentId: "covenite-coterie" },
  { id: "realspace-goodstuff", name: "Realspace Goodstuff", factionId: "drukhari", detachmentId: "realspace-raiders" },
  { id: "wych-cult-blender", name: "Wych Cult Blender", factionId: "drukhari", detachmentId: "exhibition-of-slaughter" },
  { id: "kabal-dark-lance-spam", name: "Dark Lance Spam", factionId: "drukhari", detachmentId: "kabalite-cartel" },

  // ── Necrons ────────────────────────────────────────────────────────────────
  { id: "ctan-soup", name: "C'tan Soup", factionId: "necrons", detachmentId: "pantheon-of-woe" },
  { id: "hypercrypt-monolith", name: "Monolith Slide", factionId: "necrons", detachmentId: "hypercrypt-legion" },
  { id: "canoptek-wraithwall", name: "Wraith Wall", factionId: "necrons", detachmentId: "canoptek-court" },
  { id: "silent-king-goodstuff", name: "Silent King Goodstuff", factionId: "necrons", detachmentId: "awakened-dynasty" },
  { id: "starshatter-doomsday", name: "Doomsday Gunline", factionId: "necrons", detachmentId: "starshatter-arsenal" },
  { id: "cryptek-character-spam", name: "Cryptek Character Spam", factionId: "necrons", detachmentId: "cryptek-conclave" },

  // ── Orks ───────────────────────────────────────────────────────────────────
  { id: "green-tide", name: "Green Tide", factionId: "orks", detachmentId: "green-tide" },
  { id: "bully-boyz", name: "Bully Boyz Meganobz", factionId: "orks", detachmentId: "bully-boyz" },
  { id: "kult-of-speed", name: "Kult of Speed", factionId: "orks", detachmentId: "kult-of-speed" },
  { id: "dread-mob-walkers", name: "Dread Mob Walkers", factionId: "orks", detachmentId: "dread-mob" },
  { id: "squighog-rodeo", name: "Squighog Rodeo", factionId: "orks", detachmentId: "da-big-hunt" },
  { id: "trukk-boyz", name: "Trukk Boyz", factionId: "orks", detachmentId: "war-horde" },
  { id: "flash-gitz-shootas", name: "Flash Gitz Shootas", factionId: "orks", detachmentId: "shoota-boyz" },
  { id: "battlewagon-rush", name: "Battlewagon Rush", factionId: "orks", detachmentId: "blitz-brigade" },

  // ── Tyranids ───────────────────────────────────────────────────────────────
  { id: "gaunt-carpet", name: "Gaunt Carpet", factionId: "tyranids", detachmentId: "unending-swarm" },
  { id: "crusher-stampede", name: "Crusher Stampede", factionId: "tyranids", detachmentId: "crusher-stampede" },
  { id: "harvester-farm", name: "Harvester Farm", factionId: "tyranids", detachmentId: "assimilation-swarm" },
  { id: "invasion-fleet-goodstuff", name: "Invasion Fleet Goodstuff", factionId: "tyranids", detachmentId: "invasion-fleet" },
  { id: "norn-assassins", name: "Norn Assassins", factionId: "tyranids", detachmentId: "talons-of-the-norn-queen" },
  { id: "lictor-skew", name: "Lictor Skew", factionId: "tyranids", detachmentId: "vanguard-onslaught" },
  { id: "zoanthrope-battery", name: "Zoanthrope Battery", factionId: "tyranids", detachmentId: "synaptic-nexus" },

  // ── Genestealer Cults ──────────────────────────────────────────────────────
  { id: "final-day-bomb", name: "Final Day Bomb", factionId: "genestealer-cults", detachmentId: "final-day" },
  { id: "biosanctic-rush", name: "Genestealer Rush", factionId: "genestealer-cults", detachmentId: "biosanctic-broodsurge" },
  { id: "brood-brothers-militia", name: "Brood Brothers Militia", factionId: "genestealer-cults", detachmentId: "brood-brothers-auxilia" },
  { id: "ascension-day", name: "Ascension Day Host", factionId: "genestealer-cults", detachmentId: "host-of-ascension" },
  { id: "outlander-truck-cult", name: "Outlander Truck Cult", factionId: "genestealer-cults", detachmentId: "outlander-claw" },

  // ── T'au Empire ────────────────────────────────────────────────────────────
  { id: "montka-crisis-missiles", name: "Mont'ka Crisis Missiles", factionId: "tau-empire", detachmentId: "montka" },
  { id: "kauyon-castle", name: "Kauyon Castle", factionId: "tau-empire", detachmentId: "kauyon" },
  { id: "retaliation-suit-drop", name: "Retaliation Suit Drop", factionId: "tau-empire", detachmentId: "retaliation-cadre" },
  { id: "kroot-carnival", name: "Kroot Carnival", factionId: "tau-empire", detachmentId: "kroot-hunting-pack" },
  { id: "riptide-wing", name: "Prototype Riptide Wing", factionId: "tau-empire", detachmentId: "experimental-prototype-cadre" },

  // ── Leagues of Votann ──────────────────────────────────────────────────────
  { id: "hekaton-spam", name: "Hekaton Spam", factionId: "leagues-of-votann", detachmentId: "hearthfyre-arsenal" },
  { id: "bikes-and-beards", name: "Bikes and Beards", factionId: "leagues-of-votann", detachmentId: "armoured-trailblazers" },
  { id: "hearthband-bunker", name: "Hearthband Bunker", factionId: "leagues-of-votann", detachmentId: "hearthband" },
  { id: "mercenary-berserks", name: "Mercenary Berserks", factionId: "leagues-of-votann", detachmentId: "mercenary-oathband" },
  { id: "sagitaur-msu", name: "Sagitaur MSU", factionId: "leagues-of-votann", detachmentId: "farseekers" },

  // ── Chaos Space Marines ────────────────────────────────────────────────────
  { id: "pactbound-defilers", name: "Pactbound Defilers", factionId: "chaos-space-marines", detachmentId: "pactbound-zealots" },
  { id: "soulforged-engine-spam", name: "Defiler Spam", factionId: "chaos-space-marines", detachmentId: "soulforged-warpack" },
  { id: "renegade-alpha-strike", name: "Renegade Alpha Strike", factionId: "chaos-space-marines", detachmentId: "renegade-raiders" },
  { id: "biles-freaks", name: "Bile's Freaks", factionId: "chaos-space-marines", detachmentId: "creations-of-bile" },
  { id: "night-lords-terror", name: "Night Lords Terror", factionId: "chaos-space-marines", detachmentId: "nightmare-hunt" },
  { id: "fellhammer-iron-warriors", name: "Fellhammer Iron Warriors", factionId: "chaos-space-marines", detachmentId: "fellhammer-siege-host" },
  { id: "red-corsairs", name: "Red Corsairs Raiders", factionId: "chaos-space-marines", detachmentId: "hurons-marauders" },
  { id: "accursed-cultist-tide", name: "Accursed Cultist Tide", factionId: "chaos-space-marines", detachmentId: "chaos-cult" },

  // ── Death Guard ────────────────────────────────────────────────────────────
  { id: "tallyband-defilers", name: "Tallyband Defilers", factionId: "death-guard", detachmentId: "tallyband-summoners" },
  { id: "plague-marine-brick", name: "Plague Marine Brick", factionId: "death-guard", detachmentId: "mortarions-hammer" },
  { id: "contagion-armor", name: "Contagion Armour Park", factionId: "death-guard", detachmentId: "contagion-engines" },
  { id: "blightlord-bomb", name: "Blightlord Bomb", factionId: "death-guard", detachmentId: "death-lords-chosen" },
  { id: "flyblown-drones", name: "Flyblown Drone Swarm", factionId: "death-guard", detachmentId: "flyblown-host" },

  // ── World Eaters ───────────────────────────────────────────────────────────
  { id: "eightbound-express", name: "Eightbound Express", factionId: "world-eaters", detachmentId: "berzerker-warband" },
  { id: "khorne-daemonkin-hounds", name: "Daemonkin Hounds", factionId: "world-eaters", detachmentId: "khorne-daemonkin" },
  { id: "goretrack-rhino-rush", name: "Goretrack Rhino Rush", factionId: "world-eaters", detachmentId: "goretrack-onslaught" },
  { id: "maulerfiend-pack", name: "Maulerfiend Pack", factionId: "world-eaters", detachmentId: "brazen-engines" },

  // ── Thousand Sons ──────────────────────────────────────────────────────────
  { id: "magnus-and-tupperware", name: "Magnus and the Tupperware", factionId: "thousand-sons", detachmentId: "grand-coven" },
  { id: "cult-of-duplicity", name: "Duplicity Teleports", factionId: "thousand-sons", detachmentId: "changehost-of-deceit" },
  { id: "rubric-brick", name: "Rubric Brick", factionId: "thousand-sons", detachmentId: "rubricae-phalanx" },
  { id: "hexwarp-magic-missiles", name: "Hexwarp Magic Missiles", factionId: "thousand-sons", detachmentId: "hexwarp-thrallband" },

  // ── Emperor's Children ─────────────────────────────────────────────────────
  { id: "slaanesh-blender", name: "Slaanesh Blender", factionId: "emperors-children", detachmentId: "peerless-bladesmen" },
  { id: "mercurial-speed", name: "Mercurial Speed", factionId: "emperors-children", detachmentId: "mercurial-host" },
  { id: "noise-marine-carnival", name: "Noise Marine Carnival", factionId: "emperors-children", detachmentId: "carnival-of-excess" },
  { id: "flawless-blades", name: "Flawless Blades", factionId: "emperors-children", detachmentId: "coterie-of-the-conceited" },

  // ── Chaos Daemons ──────────────────────────────────────────────────────────
  { id: "belakor-and-friends", name: "Be'lakor and Friends", factionId: "chaos-daemons", detachmentId: "shadow-legion" },
  { id: "bloodthirster-rush", name: "Bloodthirster Rush", factionId: "chaos-daemons", detachmentId: "blood-legion" },
  { id: "nurgle-soup", name: "Nurgle Soup", factionId: "chaos-daemons", detachmentId: "plague-legion" },
  { id: "seeker-cavalcade", name: "Seeker Cavalcade", factionId: "chaos-daemons", detachmentId: "cavalcade-of-chaos" },
  { id: "mixed-daemons-soup", name: "Mixed Daemons Soup", factionId: "chaos-daemons", detachmentId: "daemonic-incursion" },
  { id: "flamer-spam", name: "Flamer Spam", factionId: "chaos-daemons", detachmentId: "scintillating-legion" },

  // ── Chaos Knights ──────────────────────────────────────────────────────────
  { id: "war-dog-spam", name: "War Dog Spam", factionId: "chaos-knights", detachmentId: "houndpack-lance" },
  { id: "abaddon-walks-the-dogs", name: "Abaddon Walks the Dogs", factionId: "chaos-knights", detachmentId: "hunting-warpack" },
  { id: "iconoclast-big-knights", name: "Iconoclast Big Knights", factionId: "chaos-knights", detachmentId: "iconoclast-fiefdom" },
  { id: "infernal-despoilers", name: "Infernal Despoilers", factionId: "chaos-knights", detachmentId: "infernal-lance" },

  // ── Imperial Knights ───────────────────────────────────────────────────────
  { id: "freeblade-armigers", name: "Freeblade Armigers", factionId: "imperial-knights", detachmentId: "freeblade-company" },
  { id: "canis-rex-and-friends", name: "Canis Rex and Friends", factionId: "imperial-knights", detachmentId: "questoris-companions" },
  { id: "gallant-rush", name: "Gallant Rush", factionId: "imperial-knights", detachmentId: "valourstrike-lance" },
  { id: "armiger-screen", name: "Armiger Screen", factionId: "imperial-knights", detachmentId: "spearhead-at-arms" },

  // ── Adeptus Custodes ───────────────────────────────────────────────────────
  { id: "auric-characters", name: "Auric Character Soup", factionId: "adeptus-custodes", detachmentId: "auric-champions" },
  { id: "wardens-brick", name: "Wardens Brick", factionId: "adeptus-custodes", detachmentId: "shield-host" },
  { id: "null-maiden-sisters", name: "Null Maiden Sisters", factionId: "adeptus-custodes", detachmentId: "null-maiden-vigil" },
  { id: "caladius-tank-park", name: "Caladius Tank Park", factionId: "adeptus-custodes", detachmentId: "solar-spearhead" },
  { id: "moritoi-terminators", name: "Moritoi Terminators", factionId: "adeptus-custodes", detachmentId: "might-of-the-moritoi" },

  // ── Adepta Sororitas ───────────────────────────────────────────────────────
  { id: "bringers-of-flame", name: "Flamer Sisters", factionId: "adepta-sororitas", detachmentId: "bringers-of-flame" },
  { id: "penitent-engine-host", name: "Penitent Engine Host", factionId: "adepta-sororitas", detachmentId: "penitent-host" },
  { id: "martyrs-msu", name: "Martyrs MSU", factionId: "adepta-sororitas", detachmentId: "hallowed-martyrs" },
  { id: "castigator-hull-spam", name: "Castigator Hull Spam", factionId: "adepta-sororitas", detachmentId: "army-of-faith" },
  { id: "celestine-deathball", name: "Celestine Deathball", factionId: "adepta-sororitas", detachmentId: "champions-of-faith" },

  // ── Adeptus Mechanicus ─────────────────────────────────────────────────────
  { id: "skitarii-doggos", name: "Skitarii Doggos", factionId: "adeptus-mechanicus", detachmentId: "skitarii-hunter-cohort" },
  { id: "cybernetica-robot-wall", name: "Robot Wall", factionId: "adeptus-mechanicus", detachmentId: "cohort-cybernetica" },
  { id: "rad-zone-grind", name: "Rad-Zone Grind", factionId: "adeptus-mechanicus", detachmentId: "rad-zone-corps" },
  { id: "eradication-guns", name: "Eradication Gunline", factionId: "adeptus-mechanicus", detachmentId: "eradication-cohort" },
  { id: "explorator-servitor-farm", name: "Servitor Farm", factionId: "adeptus-mechanicus", detachmentId: "explorator-maniple" },

  // ── Astra Militarum ────────────────────────────────────────────────────────
  { id: "tank-company", name: "Tank Company", factionId: "astra-militarum", detachmentId: "armoured-infantry" },
  { id: "artillery-spam", name: "Artillery Spam", factionId: "astra-militarum", detachmentId: "siege-regiment" },
  { id: "scion-drop", name: "Scion Drop", factionId: "astra-militarum", detachmentId: "bridgehead-strike" },
  { id: "combined-arms-goodstuff", name: "Combined Arms Goodstuff", factionId: "astra-militarum", detachmentId: "combined-arms" },
  { id: "dorn-spam", name: "Dorn Spam", factionId: "astra-militarum", detachmentId: "hammer-of-the-emperor" },
  { id: "bullgryn-wall", name: "Bullgryn Wall", factionId: "astra-militarum", detachmentId: "abhuman-auxiliaries" },
  { id: "chimera-mech-spam", name: "Chimera Mech Spam", factionId: "astra-militarum", detachmentId: "mechanised-assault" },
  { id: "rough-rider-recon", name: "Rough Rider Recon", factionId: "astra-militarum", detachmentId: "recon-element" },

  // ── Grey Knights ───────────────────────────────────────────────────────────
  { id: "dreadknight-stomp", name: "Dreadknight Stomp", factionId: "grey-knights", detachmentId: "sanctic-spearhead" },
  { id: "ndk-brotherhood", name: "NDK Brotherhood Strike", factionId: "grey-knights", detachmentId: "brotherhood-strike" },
  { id: "teleport-shenanigans", name: "Teleport Shenanigans", factionId: "grey-knights", detachmentId: "immaterial-interdiction" },
  { id: "purifier-flames", name: "Purifier Flames", factionId: "grey-knights", detachmentId: "fires-of-purgation" },

  // ── Agents of the Imperium ─────────────────────────────────────────────────
  { id: "inquisition-soup", name: "Inquisition Soup", factionId: "agents-of-the-imperium", detachmentId: "ordo-malleus-daemon-hunters" },
  { id: "navy-breachers-fleet", name: "Navy Breachers Fleet", factionId: "agents-of-the-imperium", detachmentId: "imperialis-fleet" },

  // ── Space Marine chapters ──────────────────────────────────────────────────
  { id: "bobby-g-gladius", name: "Bobby G Gladius", factionId: "ultramarines", detachmentId: "gladius-task-force" },
  { id: "centurion-siege-line", name: "Centurion Siege Line", factionId: "ultramarines", detachmentId: "gravis-siege-force" },
  { id: "deathwing-brick", name: "Deathwing Brick", factionId: "dark-angels", detachmentId: "inner-circle-task-force" },
  { id: "ravenwing-hunters", name: "Ravenwing Hunters", factionId: "dark-angels", detachmentId: "darkflight-pursuit" },
  { id: "jump-pack-spam", name: "Jump Pack Spam", factionId: "blood-angels", detachmentId: "assault-brethren" },
  { id: "death-company-rush", name: "Death Company Rush", factionId: "blood-angels", detachmentId: "wrath-of-the-doomed" },
  { id: "thunderwolf-cavalry", name: "Thunderwolf Cavalry", factionId: "space-wolves", detachmentId: "stormlance-task-force" },
  { id: "fenris-beastslayers", name: "Fenris Beastslayers", factionId: "space-wolves", detachmentId: "saga-of-the-beastslayer" },
  { id: "templar-crusaders", name: "Templar Crusaders", factionId: "black-templars", detachmentId: "vow-sworn-crusaders" },
  { id: "sword-brethren-raiders", name: "Sword Brethren Land Raiders", factionId: "black-templars", detachmentId: "marshals-household" },
  { id: "iron-hands-dreadnoughts", name: "Iron Hands Dreadnoughts", factionId: "iron-hands", detachmentId: "ironstorm-spearhead" },
  { id: "white-scars-bikes", name: "White Scars Bikes", factionId: "white-scars", detachmentId: "spearpoint-task-force" },
  { id: "salamanders-flamers", name: "Salamanders Flame Aggressors", factionId: "salamanders", detachmentId: "forgefathers-seekers" },
  { id: "fists-castle", name: "Fists Castle Gunline", factionId: "imperial-fists", detachmentId: "ceramite-sentinels" },
  { id: "raven-guard-phobos", name: "Raven Guard Phobos Skew", factionId: "raven-guard", detachmentId: "shadowmark-talon" },
  { id: "deathwatch-kill-teams", name: "Deathwatch Kill Teams", factionId: "deathwatch", detachmentId: "black-spear-task-force" },
];
