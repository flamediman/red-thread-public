// Звуки мира через ElevenLabs Sound Effects → public/sfx/<мир>/<роль>.m4a (готовые пропускает).
//   node tools/sfx.mjs noir [--only a,b] [--force]
// Роли одинаковые во всех мирах (движок и сценарии просят «phone-ring», «drawer», «suspense-01»…),
// а звучат по-своему: в нуаре — дисковый телефон и оркестр, в неоне — синтетика и глитчи.
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

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
    'rumble': ['Deep orchestral bass drum and low cello swell, ominous, old movie score, no electronic sounds', 3]
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
    'rain-heavy': ['Heavy rain on a neon megacity street at night: rain on metal awnings, distant hover traffic, electric hum of neon signs, seamless ambience', 22, true],
    'rain-soft': ['Light rain in a cyberpunk alley at night: soft drizzle, dripping pipes, far away synth music from a bar, neon buzz, seamless ambience', 22, true],
    'wind-haunted': ['Wind howling between skyscrapers with faint mechanical whine and distant drones, seamless ambience', 22, true],
    'room-tone': ['Server room ambience: cooling fans, soft electrical hum, occasional data clicks, seamless', 22, true],
    'dawn': ['Early morning in a cyberpunk city after rain: distant traffic waking, birds and a quiet synth pad drone, seamless', 22, true],
    'ocean-pier': ['Industrial harbor at dawn in a futuristic city: water lapping on concrete, distant cranes and horns, seamless', 22, true],
    'steps-wood': ['Footsteps on wet metal grating, slow and steady', 3],
    'typewriter': ['Fast typing on a mechanical cyberdeck keyboard with soft synthetic confirmation beeps', 3],
    'match': ['Electronic cigarette lighter click and plasma coil hiss', 1.5],
    'door-knock': ['Knocking on a metal sliding door, then pneumatic hiss', 2],
    'door-squeak': ['Automatic sliding door opening with pneumatic hiss and servo motor', 2]
  }
}

const pack = PACKS[world]
if (!pack) { console.error('мир:', Object.keys(PACKS).join(', ')); process.exit(1) }
const OUT = resolve(root, 'public/sfx', world)
mkdirSync(OUT, { recursive: true })

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
  console.log(`  ✓ ${name} (${seconds} с)`)
}
console.log('кредитов после:', await credits())
