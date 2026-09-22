// Звуки мира через ElevenLabs Sound Effects → public/sfx/<мир>/<роль>.m4a (готовые пропускает).
//   node tools/sfx.mjs noir [--only a,b] [--force]
// Роли одинаковые во всех мирах (движок и сценарии просят «phone-ring», «drawer», «suspense-01»…),
// а звучат по-своему: в нуаре — дисковый телефон и оркестр, в неоне — синтетика и глитчи.
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const env = Object.fromEntries(readFileSync(resolve(root, '.env'), 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const KEY = env.ELEVENLABS_API_KEY
const world = process.argv[2]
const args = process.argv.slice(3)
const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null
const force = args.includes('--force')

/** роль → [промпт, длительность с, петля?] */
const PACKS = {
  noir: {
    'phone-ring': ['Vintage 1950s rotary desk telephone, loud mechanical metal bell ringing two times in a quiet room, realistic, no music', 3.5],
    'static': ['Old analog telephone call from the 1950s: receiver lifted with a plastic click, then faint warm line hum and soft crackle, no digital noise, no music', 3],
    'suspense-01': ['Short 1950s film noir orchestral sting: low pizzicato double bass and muted trumpet, mysterious, then silence, no drums', 3],
    'suspense-04': ['1950s film noir orchestral stinger: descending low strings with a soft muted brass chord, uneasy resolution', 3],
    'suspense-06': ['Old Hollywood film noir shock chord: sharp tremolo strings and low piano hit, then decaying reverb', 3],
    'suspense-07': ['Classic film noir dramatic reveal: slow swelling orchestra with timpani roll and brass chord, 1950s movie score', 4],
    'rumble': ['Deep orchestral bass drum and low cello swell, ominous, old movie score, no electronic sounds', 3],
    // доска дела (режим «на время») и «Витрина»
    'board-pin': ['A brass thumbtack pushed into a cork board, then a taut red thread plucked once, close microphone, quiet room, no music', 1.5],
    'board-solve': ['Short 1950s film noir revelation sting: soft muted brass chord with a gentle celesta shimmer on top, then silence, no drums', 3],
    'board-wrong': ['A dull wooden knock on a desk and a low muted piano cluster, short disappointment, dry room, no music after', 1.5],
    'electric-spark': ['Sharp electrical arc from an old switchboard: a snapping spark, crackle and a buzzing hum dying out, close, no music', 2.5],
    'fuse-pop': ['Old porcelain electrical fuse blowing with a small pop and fizz, then a relay click and silence', 1.5],
    'music-box': ['An old detuned children music box plays a few slow notes of a waltz and winds down to a stop, eerie, close microphone, no other sounds', 4.5],
    'truck-engine': ['An old 1950s truck engine starting in hard frost: cranking, sputtering to life, rough idle, then driving away across a snowy courtyard', 7],
    'crowd-murmur': ['Muffled crowd of people waiting outside closed shop doors on a winter morning, murmur heard through thick glass, a few children voices far away, no music', 6],
    'steps-snow': ['Slow footsteps crunching on hard frozen snow at night, close, no wind, no music', 3]
  },
  neon: {
    'phone-ring': ['Futuristic holographic phone call chime, two soft synthetic tones with glassy shimmer, cyberpunk interface', 2.5],
    'static': ['Encrypted cyberpunk video call connecting: short digital glitch burst, data chirps, then clean synth tone', 2.5],
    'drawer': ['Sci-fi evidence scanner beep with a quick laser sweep and soft data confirmation chime', 1.5],
    'door-knob': ['Electronic security lock rejecting access: short buzz and two low synthetic beeps', 1.5],
    'switch': ['Small drone propellers spinning up with a servo whir, close microphone', 2],
    'glassware': ['Neon bar ambience accent: ice in a glass clinking, synth hum in background', 1.5],
    'clock-tick': ['Minimal cyberpunk digital countdown ticks, soft clicky synth pulses, 1 per second', 4, true],
    'clock-tick-slow': ['Slow deep synth heartbeat pulse with subtle digital tick, tense, cyberpunk', 5, true],
    'clock-bell': ['Cyberpunk system notification: rising bright synth arpeggio with a glassy tone', 2],
    'suspense-01': ['Short dark synthwave sting: detuned analog bass hit with reverb tail, cyberpunk thriller', 3],
    'suspense-04': ['Glitchy cyberpunk stinger: descending distorted synth sweep with digital artifacts', 3],
    'suspense-06': ['Shock synth hit with heavy sub bass drop and glitch stutter, cyberpunk horror', 3],
    'suspense-07': ['Cinematic cyberpunk reveal: huge analog synth swell with sub bass and metallic impact', 4],
    'rumble': ['Deep sub bass drone swell with distorted low synth, ominous cyberpunk', 3],
    'heartbeat': ['Heartbeat monitor from a futuristic medical implant: steady electronic beeps with low synthetic pulse', 3],
    'gasp': ['Woman gasps in shock, close microphone, clean', 1.5],
    'thunder-roll': ['Distant thunder over a huge rainy megacity with faint sirens, low rumble', 5],
    'thunder-clap': ['Sharp thunder crack over a cyberpunk city with electrical buzz of neon signs flickering', 3],
    // длинные фоны (дождь, ветер, гул помещения, рассвет, пристань) генератор делает не длиннее 22 с и с артефактами:
    // петля слышна и звучит «урезанно». Для них остаются общие записи из public/sfx.
    'steps-wood': ['Footsteps on wet metal grating, slow and steady', 3],
    'typewriter': ['Fast typing on a mechanical cyberdeck keyboard with soft synthetic confirmation beeps', 3],
    'match': ['Electronic cigarette lighter click and plasma coil hiss', 1.5],
    'door-knock': ['Knocking on a metal sliding door, then pneumatic hiss', 2],
    'door-squeak': ['Automatic sliding door opening with pneumatic hiss and servo motor', 2]
  },
  // «Туман»: одиночная игра. Никакой музыки в звуках — только тишина, сырость, далёкий горн и то, что в тумане
  tuman: {
    // петли атмосферы
    'fog-wind': ['Steady low moaning wind blowing through an abandoned foggy village and pine trees, hollow airy whoosh, occasional creak of a wooden pole, clearly audible, no birds, no music, seamless ambience loop', 14, true],
    'water-lap': ['Gentle lake water lapping against concrete steps and wooden pier posts in thick fog, slow irregular small waves, quiet, close, no music, seamless ambience', 12, true],
    'room-hum': ['Interior ambience of an abandoned Soviet building: steady low electrical mains hum and air rumble, occasional distant wooden creak, clearly audible, no music, seamless ambience loop', 12, true],
    'fog-drip': ['Slow water drops falling from a ceiling into puddles in an empty dark room, irregular echoing drips, no music, seamless ambience', 12, true],
    'radio-static-soft': ['A very quiet old transistor radio left on between stations in a basement: soft hiss and faint crackle with barely audible distant voices, no music, seamless ambience', 12, true],
    'kitchen-simmer': ['A large pot of porridge quietly simmering on an old canteen stove, soft bubbling, a spoon lightly tapping aluminium far away, warm but lonely, no music, seamless ambience', 12, true],
    'radio-static': ['Portable transistor radio loud white noise static with crackling bursts and unstable warbling interference, harsh and nervous, no music, no voices, seamless loop', 8, true],
    'dread-drone': ['Low ominous horror drone: deep sub bass rumble with a slowly pulsing dissonant metallic scrape, oppressive tension, no melody, no drums, seamless loop', 12, true],
    // шаги
    'step-asphalt': ['Four slow footsteps of leather shoes on wet asphalt in fog, close, no music', 2.5],
    'step-wood': ['Four slow footsteps on old damp wooden planks of a bridge, soft creaks, close, no music', 2.5],
    'step-tile': ['Four slow footsteps on a tiled floor in an empty hall with glass crunching under shoes, echo, no music', 2.5],
    'step-water': ['Four slow footsteps splashing through shallow puddles on asphalt, close, no music', 2.5],
    'step-grass': ['Four slow footsteps on wet grass and pine needles, close, no music', 2.5],
    // мир
    'truck-leave': ['An old Soviet truck turning around on a forest road and driving away, the engine sound fading into complete silence, no music', 7],
    'turnstile': ['An old rusty metal pedestrian turnstile rotating with a long squeaky grinding creak and a heavy clank, close, no music', 2.5],
    'door-locked': ['Someone tries a locked old door: the handle rattles twice, the lock holds, dry metallic clunk, no music', 1.5],
    'lock-open': ['A key turning in an old lock with a heavy click, then a door creaking slightly open, close, no music', 2],
    'drawer-metal': ['A metal desk drawer pulled open with a scrape, a heavy flashlight lifted from it, close, no music', 2],
    'paper': ['Old envelopes and paper letters being taken out of a canvas sack and unfolded, rustling, close, quiet room, no music', 2.5],
    'pipe-pick': ['A heavy metal water pipe picked up from concrete floor with a scraping clang, close, no music', 1.5],
    'flashlight-on': ['A heavy old flashlight switch clicked on, a tiny filament buzz, close, no music', 0.8],
    'flashlight-off': ['A heavy old flashlight switch clicked off, close, no music', 0.8],
    'battery-in': ['A flat battery pushed into a plastic compartment with a snap and a lid closing, close, no music', 1.2],
    'whisper-far': ['Eerie breathy whisper of a child calling a name from the fog, clearly audible with long echo, unintelligible words, horror, no music', 3],
    'phone-far-bugle': ['An old telephone receiver: a dial tone, a click, then through heavy line noise a distant bugle playing a slow lights-out call that breaks off midway, eerie, no other music', 6],
    'oarlocks': ['Rhythmic creaking of wooden rowing boat oarlocks and slow oar strokes on calm water in fog, getting farther away, no music', 5],
    'bugle-far-cut': ['A lone bugle very far away across a foggy lake playing a slow lights-out call, the melody suddenly stops in the middle, long silent echo, eerie', 6],
    'sting-soft': ['Subtle horror sting: a low reversed piano note swelling into a quiet metallic shimmer, then silence, no drums', 2.5],
    // существа
    'bugle-near': ['A dented brass bugle blown badly and slowly by a child very close in fog: a wobbly broken off-key note with wet breath, horrifying, no music', 3],
    'bugle-blast': ['A sudden deafening off-key bugle blast right at the ear, distorted brass scream with ringing in the ears afterwards, horror, no music', 2],
    'thud-cloth': ['A heavy metal pipe hitting a small body wrapped in wet cloth: a dull thud and a clatter of a brass bugle on the floor, close, no music', 1.2],
    'cloth-fall': ['A small empty body of wet clothes collapsing to the ground softly, a brass bugle rolling away on asphalt, then silence, no music', 2.5],
    'wet-near': ['Something heavy and wet rising out of a puddle: thick gurgling water, dripping mud, slow squelching, deep breathing through water, horror, no music', 4],
    'wet-grab': ['Cold wet hands grabbing a man: a heavy splash and wet slap, a choking gasp with water in the throat, horror, no music', 2],
    'wet-hurt': ['A metal pipe hitting a soft body of mud and algae: a deep wet squelch and splatter, close, no music', 1.2],
    'water-splash': ['A large mass of water collapsing onto asphalt with a big splash and dripping afterwards, then silence, no music', 2.5],
    // герой
    'solo-swing': ['A quick swing of a heavy metal pipe through the air with a whoosh, close, no music', 0.8],
    'solo-shot': ['A single pistol shot in a foggy empty street, sharp crack and a long dull echo, no music', 2],
    'solo-run': ['A man running away fast on wet asphalt, heavy panicked breathing, footsteps fading, no music', 2.5],
    'solo-hide': ['A man holding his breath while hiding behind shelves: a soft shuffle, a nervous tiny exhale, heartbeat in the ears, no music', 2.5],
    'solo-heal': ['Tearing a paper wrapper of a bandage and wrapping gauze, a small glass bottle cap unscrewed, close, no music', 2.5],
    'solo-combine': ['Small mechanical click of parts snapping together, then a portable radio crackling to life, close, no music', 1.8],
    'solo-wrong': ['A dial lock clicking without opening, a dull metallic denial clunk, close, no music', 1],
    'solo-save': ['An old telephone receiver placed back on its hook with a heavy click and a short soft dial tone ring, close, no music', 2],
    // главы 2–3: санаторий и лагерь
    'other-hum': ['Oppressive industrial ambience of a flooded rusted building: deep low metallic groan, distant dripping pipes, slow resonant creaks of iron, no music, seamless ambience loop', 14, true],
    'flag-rope': ['A metal flagpole rope slapping against the hollow pole in slow gusts of wind, irregular metallic clinks, empty camp, fog, no music, seamless ambience loop', 12, true],
    'lantern-chain': ['A heavy slow figure walking on gravel: big boots crunching, an old kerosene lantern creaking on its handle, a chain clinking at every step, getting closer, horror, no music', 4],
    'hook-hit': ['A heavy wooden boathook pole with an iron hook striking a man hard: whoosh, dull thud, a pained grunt, close, no music', 1.5],
    'door-bang': ['A heavy iron grate on stairs slammed and then violently shaken from outside, rattling metal, horror, no music', 2.5],
    'tape-play': ['An old reel-to-reel tape recorder switched on: mechanical clunk, reels starting to spin, soft tape hiss and a faint microphone click, no voices, no music', 3],
    'siren-bugle': ['A long off-key bugle note blown badly somewhere far above in a big empty building, wavering like a siren, then lights buzzing and dying out with electrical clicks, horror, no melody', 5],
    'water-drain': ['Old pipes groaning and shuddering, then a large pool of water draining through a floor drain with a long deep gurgling swirl and a final sucking sound, echoing tiled room, no music', 5],
    'radio-tune': ['Turning the tuning dial of an old tube radio transmitter: sweeping static, whistles and warbles, then a loud click as a loudspeaker system switches on with a hum, no voices, no music', 3],
    'whistle-near': ['A sports referee whistle blown in short sharp rhythmic blasts somewhere down a dark corridor, getting closer fast, footsteps of hard shoes, horror, no music', 3],
    'whistle-blast': ['A shrill deafening referee whistle blast right at the ear, distorted and painful, with a body slammed against a wooden wall, horror, no music', 2],
    'counselor-hurt': ['A metal pipe hitting a tall body in a starched cotton blouse: dull thud, a whistle choking with a wet gurgle, close, no music', 1.2],
    'counselor-die': ['A tall body collapsing onto wooden floor like an empty coat, then a small metal whistle rolling slowly across floorboards and stopping, silence, no music', 3],
    'bugle-far-full': ['A lone bugle far away across a calm lake at dawn playing a slow gentle lights-out call cleanly from start to end, soft echo over water, peaceful and sad', 8],
    // 16.09: полнота атмосферы — карманы, карта, приёмник, точки босса, оружие; лес, громкоговоритель лагеря; далёкие звуки
    'pocket': ['A small object slipped into the pocket of a canvas jacket: a soft cloth rustle and a light tap, close, quiet, no music', 1.5],
    'map-unfold': ['A folded paper map unfolded quickly in two moves, crisp paper crackle, close, quiet room, no music', 1.8],
    'radio-click': ['A stiff plastic slider switch of an old Soviet transistor radio clicked once, short dry click, close, no music', 0.7],
    'qte-tick': ['A single short soft wooden tick, like a pencil tapped once on a table, dry, close, no music', 0.5],
    'flaregun-load': ['A break-action flare pistol opened with a metallic click, a cardboard cartridge pushed in, snapped shut, close, no music', 1.5],
    'loudspeaker-hum': ['A dead old horn loudspeaker on a wooden pole in an empty pioneer camp: faint steady electric hum with occasional soft crackle and a barely audible distant garbled voice, quiet, no music, seamless ambience loop', 12, true],
    'pines': ['Tall pine trees slowly creaking and swaying in a light wind in a foggy forest, occasional wood creak, soft needle rustle, no birds, no music, seamless ambience loop', 14, true],
    'announce-far': ['A distant loudspeaker announcement echoing across a lake in fog, muffled unintelligible woman voice, crackling, very far away, then silence, no music', 5],
    'branch-far': ['A dry branch cracking somewhere far away in a foggy pine forest, then silence, no music', 2],
    // ближний слой: случайные звуки рядом с героем раз в 10–25 с, по типу места
    'creak-floor': ['A single slow creak of an old wooden floorboard under weight in a quiet empty room, close, no music', 1.5],
    'drip-one': ['One single water drop falling from a ceiling into a shallow puddle in a dark tiled room with a short echo, no music', 1],
    'wind-window': ['A gust of wind pressing on an old wooden window frame, the loose pane rattles softly twice, heard from inside a quiet room, no music', 3],
    'glass-tinkle': ['A small shard of broken glass pushed by a shoe on a tiled floor, a light tinkle, close, quiet room, no music', 1.2],
    'pipe-knock': ['An old water heating pipe in a wall knocking twice with a dull metallic clank, then a faint hiss, quiet building, no music', 1.5],
    'gust': ['A single gust of wind rising through pine branches and dying away, soft rustle and a hollow whoosh, outdoors in fog, no music', 3],
    'leaf-scrape': ['Dry leaves and a sheet of newspaper scraping across wet asphalt in a light gust, then still, close, no music', 2],
    'water-surge': ['One larger lake wave slapping against wooden pier posts and receding with dripping, close, calm night, no music', 2.5],
    'metal-groan': ['A long low groan of rusted iron structure under strain in a flooded abandoned building, deep resonant, slowly fading, horror ambience, no music', 3],
    'solo-hurt': ['A heavy blow landing on a man: a dull body impact, a sharp pained gasp and a stumble on wet ground, close, no music', 1.3],
    'solo-hit-land': ['A metal pipe connecting hard with something wet and heavy: a deep crunching thud with a short ring of the pipe, close, no music', 0.9],
    'solo-dodge': ['A man quickly sidestepping a blow: a sharp intake of breath, a fast cloth whoosh and one heavy step on wet ground, then a heavy object whistling past and hitting nothing, close, no music', 1.5],
    'other-pulse': ['Very slow deep sub-bass pulse like the heartbeat of a huge flooded building, one soft thump every few seconds with a faint metallic resonance, oppressive, no melody, no drums, seamless ambience loop', 12, true]
  }
}

const pack = PACKS[world]
if (!pack) { console.error('мир:', Object.keys(PACKS).join(', ')); process.exit(1) }
const OUT = resolve(root, 'public/sfx', world)
mkdirSync(OUT, { recursive: true })

/* Громкость: генератор отдаёт звуки от шёпота на -70 дБ до крика на 0. Для «Тумана» всё выравнивается по средней громкости:
   петли атмосферы тише, одиночные звуки громче, пики — не выше -1 дБ. `--normalize` — только выровнять готовые файлы. */
const LEVEL = { tuman: { loop: -30, shot: -21 } }
/** удары и крики громче ровного уровня, мелочи вроде щелчка фонаря — тише */
/* далёкое — заметно ниже ровного уровня: горн за озером не должен звучать как горн в руке (16.09.2026 — «слишком громкий и навязчивый») */
const ACCENT = { 'hook-hit': 5, 'whistle-blast': 6, 'door-bang': 4, 'bugle-far-full': -6, 'bugle-far-cut': -8, 'siren-bugle': -5, 'oarlocks': -5, 'phone-far-bugle': -3, 'announce-far': -8, 'branch-far': -6,
  'fog-drip': -4, 'flag-rope': -3, 'loudspeaker-hum': -3, 'qte-tick': -8, 'radio-click': -6, 'pocket': -5, 'map-unfold': -4, 'flaregun-load': -2,
  'solo-dodge': -2, 'solo-hurt': 3, 'solo-hit-land': 2, 'creak-floor': -8, 'drip-one': -8, 'wind-window': -6, 'glass-tinkle': -10, 'pipe-knock': -7, 'gust': -5, 'leaf-scrape': -8, 'water-surge': -5, 'metal-groan': -6, 'other-pulse': -2,
  'bugle-blast': 6, 'wet-grab': 5, 'solo-shot': 6, 'water-splash': 3, 'bugle-near': 2, 'whisper-far': -8, 'flashlight-on': -7, 'flashlight-off': -7, 'battery-in': -5, 'paper': -4, 'solo-hide': -3, 'step-asphalt': -3, 'step-wood': -3, 'step-tile': -3, 'step-water': -3, 'step-grass': -3 }
function normalize(file, loop) {
  const base = LEVEL[world]?.[loop ? 'loop' : 'shot']
  if (base == null) return
  const target = base + (ACCENT[file.split('/').pop().replace(/\.m4a$/, '')] ?? 0)
  // по воспринимаемой громкости (LUFS), а не по средней: редкие капли или далёкий горн со средней громкостью выходили громче ветра
  const log = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' }).stderr ?? ''
  const mean = Number(/Integrated loudness:\s*I:\s*(-?[\d.]+) LUFS/.exec(log)?.[1])
  if (!Number.isFinite(mean)) return
  const gain = Math.max(-30, Math.min(30, target - mean))
  if (Math.abs(gain) < 1) return
  const tmp = file.replace(/\.m4a$/, '.norm.m4a')
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-af', `volume=${gain.toFixed(1)}dB,alimiter=limit=0.89:level=false`, '-c:a', 'aac', '-b:a', '160k', tmp])
  execFileSync('mv', [tmp, file])
  console.log(`  ≈ ${file.split('/').pop()}: ${mean.toFixed(1)} → ${target} дБ`)
}

if (args.includes('--normalize')) {
  for (const [name, [, , loop]] of Object.entries(pack)) {
    if (only && !only.has(name)) continue
    const file = resolve(OUT, `${name}.m4a`)
    if (existsSync(file)) normalize(file, loop)
  }
  process.exit(0)
}

const credits = async () => { try { return (await (await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': KEY } })).json()).character_count } catch { return '?' } }
console.log('кредитов до:', await credits())
for (const [name, [text, seconds, loop]] of Object.entries(pack)) {
  if (only && !only.has(name)) continue
  const file = resolve(OUT, `${name}.m4a`)
  if (existsSync(file) && !force) { console.log(`  = ${name}`); continue }
  const body = { text, duration_seconds: seconds, prompt_influence: 0.5 }
  if (loop) body.loop = true
  let r
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      r = await fetch('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128', {
        method: 'POST', headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      })
      if (r.status !== 429 && r.status < 500) break
    } catch (e) { console.log(`  … ${name}: ${e.cause?.code ?? e.message}, повтор`) }
    await new Promise(res => setTimeout(res, 5000 * attempt))
  }
  if (!r) { console.log(`  ✗ ${name}: сеть`); continue }
  if (!r.ok) { console.log(`  ✗ ${name}: ${r.status} ${(await r.text()).slice(0, 160)}`); continue }
  const tmp = file + '.mp3'
  writeFileSync(tmp, Buffer.from(await r.arrayBuffer()))
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-c:a', 'aac', '-b:a', '160k', file])
  unlinkSync(tmp)
  normalize(file, loop)
  console.log(`  ✓ ${name} (${seconds} с)`)
}
console.log('кредитов после:', await credits())
