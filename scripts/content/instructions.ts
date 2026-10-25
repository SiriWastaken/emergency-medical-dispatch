import type { Row } from './dsl'

const SOURCE = 'Roleplay training script, modeled on commonly published public first-aid guidance. Not a certified protocol.'

const lines = (...l: string[]) => l.join('\n')

/** [id, incident type, title, script]. Written to be read aloud by the call-taker. */
const INSTRUCTIONS: [string, string, string, string][] = [
  [
    'cpr', 'ALL', 'CPR instructions (adult or child)',
    lines(
      "I'm going to help you start chest compressions. Stay on the line with me.",
      '1. Lay the patient flat on their back on a firm surface. Kneel beside them.',
      '2. Put the heel of one hand on the center of the chest, between the nipples. Put your other hand on top and lock your elbows.',
      '3. Push straight down hard and fast: at least 2 inches (5 cm) deep, about 100 to 120 pushes a minute. Let the chest rise fully between pushes.',
      '4. Count out loud with me: one, two, three, four... (count with the caller)',
      "5. Don't stop. Keep going until help takes over, the patient starts moving or breathing normally, or you cannot continue.",
      '6. If someone can bring an AED (defibrillator), send them now and follow its spoken instructions.',
    ),
  ],
  [
    'cpr-infant', 'ALL', 'CPR instructions (baby under one year)',
    lines(
      "I'm going to help you with chest compressions for the baby. Stay on the line.",
      '1. Lay the baby on their back on a firm surface.',
      '2. Put two fingers in the center of the chest, just below the nipple line.',
      '3. Push down about 1.5 inches (4 cm), about 100 to 120 pushes a minute. Let the chest come back up fully each time.',
      '4. Count out loud with me: one, two, three, four... (count with the caller)',
      "5. Don't stop until help takes over or the baby starts to move, cry or breathe normally.",
    ),
  ],
  [
    'choking', 'ALL', 'Choking instructions (adult or child, Heimlich)',
    lines(
      "I'm going to help you clear the airway. Stay on the line.",
      '1. Stand behind the patient and wrap your arms around their waist.',
      '2. Make a fist with one hand. Put the thumb side against the belly, just above the belly button and well below the ribs.',
      '3. Grab that fist with your other hand and give quick, hard thrusts inward and upward.',
      '4. Keep going until the object comes out or the patient can breathe, cough or speak.',
      '5. If the patient becomes unresponsive, lower them to the floor, tell me, and we will start chest compressions. Each time you open the mouth, look for the object and remove it only if you can see it.',
    ),
  ],
  [
    'choking-infant', 'ALL', 'Choking instructions (baby under one year)',
    lines(
      "I'm going to help you clear the baby's airway. Stay on the line.",
      "1. Sit down and lay the baby face down along your forearm, supporting the head and jaw, with the head lower than the body.",
      '2. Give 5 firm back blows between the shoulder blades with the heel of your other hand.',
      '3. Turn the baby face up on your forearm, head still lower than the body. Give 5 chest thrusts: two fingers in the center of the chest, pushing down about 1.5 inches (4 cm).',
      '4. Keep repeating 5 back blows and 5 chest thrusts until the object comes out or the baby cries or breathes.',
      '5. If the baby becomes unresponsive, tell me and we will start infant chest compressions.',
    ),
  ],
  [
    'recovery-position', 'ALL', 'Unresponsive but breathing: recovery position',
    lines(
      'Stay with the patient and keep checking that they are breathing.',
      '1. Roll them onto their side.',
      '2. Bend the top knee so they cannot roll onto their front, and tuck their top hand under their cheek.',
      '3. Tilt the head back slightly so the mouth faces down and the airway stays open.',
      '4. Do not give food or drink. If they stop breathing, tell me right away and we will start chest compressions.',
    ),
  ],
  [
    'bleeding-control', 'ALL', 'Bleeding control',
    lines(
      "Let's stop the bleeding. Stay on the line.",
      '1. Press a clean cloth, shirt or towel directly on the wound and push down hard with both hands.',
      "2. Don't lift it to look. If blood soaks through, put more cloth on top and keep pressing.",
      '3. Have the patient lie down if they feel faint. Keep pressing until help takes over.',
      '4. Wash your hands afterward if you can, and tell me if the patient becomes pale, confused or stops responding.',
    ),
  ],
  [
    'seizure-care', 'ALL', 'Seizure care',
    lines(
      'Stay with the patient. Seizures usually stop on their own.',
      "1. Don't hold them down and don't put anything in their mouth.",
      '2. Move hard or sharp objects away and cushion their head with something soft.',
      '3. Loosen anything tight around the neck. Note the time the seizure started.',
      '4. When the jerking stops, roll them onto their side and stay with them. Tell me if they are not breathing.',
    ),
  ],
  [
    'burn-care', 'ALL', 'Burn care',
    lines(
      "Let's cool the burn. Stay on the line.",
      '1. Get the patient away from the heat, flames or chemical. Take off clothing and jewelry near the burn unless it is stuck to the skin.',
      '2. Cool the burn with cool (not ice-cold) running water for at least 10 minutes. For a chemical burn, first brush off any dry powder, then flush with plenty of water.',
      "3. Don't use ice, butter or ointments, and don't pop blisters.",
      '4. Cover it loosely with a clean, dry cloth. Keep the patient warm.',
    ),
  ],
  [
    'chest-pain-care', 'ALL', 'Chest pain care',
    lines(
      'Keep the patient calm and still. Stay on the line.',
      '1. Have them sit or lie in the position that is most comfortable. No walking or exertion.',
      '2. Unlock the front door and put pets away so help can reach the patient.',
      '3. If the patient is not allergic to aspirin and has not been told by a doctor to avoid it, they may chew one regular-strength (325 mg) aspirin, or four low-dose (81 mg) tablets.',
      "4. Tell me right away if they pass out or stop breathing.",
    ),
  ],
  [
    'breathing-care', 'ALL', 'Breathing difficulty care',
    lines(
      'Help the patient stay calm. Stay on the line.',
      '1. Let them sit upright, leaning slightly forward, in the position that is easiest for breathing.',
      '2. Loosen tight clothing. If they have a prescribed inhaler, help them use it as labeled.',
      '3. Open a window for fresh air and unlock the front door for the crew.',
      '4. Tell me right away if their lips turn blue or gray, or they stop responding.',
    ),
  ],
  [
    'stroke-care', 'ALL', 'Stroke care',
    lines(
      'Keep the patient calm and still. Stay on the line.',
      '1. Have them sit or lie down with the head slightly raised.',
      "2. Don't give food, drink or medicine, including aspirin.",
      '3. Write down the time the symptoms started, or when they were last seen normal, and tell the crew.',
      '4. If they vomit or become drowsy, roll them onto their side. Unlock the door for the crew.',
    ),
  ],
  [
    'allergic-care', 'ALL', 'Allergic reaction care',
    lines(
      'Stay with the patient. Stay on the line.',
      '1. Remove whatever caused the reaction if you can, for example scrape off a bee stinger with a card.',
      '2. If the patient has a prescribed epinephrine auto-injector and has severe symptoms, help them use it exactly as the label says.',
      '3. Have them sit or lie down, with legs raised if they feel faint. Loosen tight clothing.',
      "4. Don't give anything to eat or drink. Tell me right away if they stop breathing.",
    ),
  ],
  [
    'overdose-care', 'ALL', 'Overdose or poisoning care',
    lines(
      'Stay with the patient. Stay on the line.',
      "1. Don't make them vomit and don't give anything to eat or drink.",
      '2. Collect the pill bottles, containers or substance and keep them for the crew.',
      '3. Keep them awake and talking. If they are unresponsive but breathing, roll them onto their side.',
      '4. Tell me right away if they stop breathing and we will start chest compressions.',
    ),
  ],
  [
    'diabetic-care', 'ALL', 'Low blood sugar care',
    lines(
      'Stay with the patient. Stay on the line.',
      '1. If they are awake and can swallow safely, give them a sugary drink or glucose tablets.',
      '2. Have them sit down and rest.',
      "3. If they become drowsy or cannot swallow, don't put anything in their mouth. Roll them onto their side and tell me.",
    ),
  ],
  [
    'childbirth-care', 'ALL', 'Childbirth instructions',
    lines(
      "Stay calm, I'm going to help you. Stay on the line.",
      '1. Help the mother lie back on clean towels or blankets with her knees up and apart. Wash your hands if you can.',
      "2. Do not pull. When the baby's head appears, support it gently as the baby comes out. If the cord is around the neck, gently slip it over the head.",
      '3. Once the baby is out, dry them with a clean towel, rub the back gently, and keep them warm on the mother\'s chest, covered with a blanket.',
      "4. Don't cut or pull the cord. Keep the mother warm and tell me if she is bleeding heavily or the baby is not breathing.",
    ),
  ],
  [
    'do-not-move', 'ALL', 'Possible spine injury: do not move',
    lines(
      "Please don't move the patient unless they are in immediate danger, such as fire or traffic.",
      '1. Tell them to stay still and keep their head and neck in the position they are in.',
      '2. Keep them warm and calm. If they vomit or cannot breathe, tell me and we will decide together how to turn them.',
    ),
  ],
  [
    'safety-suicide', 'ALL', 'Self-harm safety',
    lines(
      "I'm here with you. Stay on the line.",
      '1. Stay with the patient. Do not leave them alone.',
      '2. If it is safe, move any weapons, pills or other dangerous items out of reach.',
      '3. Speak calmly and listen. Do not argue. Tell me right away if anything changes or the situation becomes unsafe.',
    ),
  ],
  [
    'pd-stay-safe', 'PD', 'Stay safe until officers arrive',
    lines(
      'Stay on the line with me. Help is on the way.',
      '1. Move to a safe place away from the person if you can, and lock the door.',
      "2. Don't confront anyone. If you are in danger, stay quiet and tell me what you can.",
      '3. Tell me right away if anything changes. When officers arrive, show your hands and follow their instructions.',
    ),
  ],
  [
    'pd-do-not-confront', 'PD', 'Do not confront',
    lines(
      '1. Please do not try to stop or confront the person.',
      '2. Stay where you are safe and keep watching from a distance if you can do that safely.',
      '3. Tell me about any changes: where they go, what they are wearing, and any vehicle.',
    ),
  ],
  [
    'pd-lock-and-wait', 'PD', 'Lock the door and wait',
    lines(
      '1. Go to a room that locks, and lock the door. Move away from the door and windows.',
      '2. Silence your phone ringer, but stay on the line with me.',
      "3. Don't come out until officers tell you it is safe. Tell me what you can hear.",
    ),
  ],
  [
    'traffic-safety', 'PD', 'Traffic safety',
    lines(
      '1. If your vehicle can be driven and no one is badly hurt, move it out of traffic. Turn on the hazard lights.',
      '2. Stay inside your vehicle with your seat belt on, or stand well off the road, away from traffic.',
      "3. Don't stand between vehicles or in the lane. Wait for officers.",
    ),
  ],
  [
    'fire-evacuate', 'FD', 'Get out and stay out',
    lines(
      'Get everyone out of the building right now. Stay on the line if you can do that safely.',
      "1. Don't stop for belongings or pets. Take only your phone.",
      '2. If there is smoke, stay low and crawl under it. Close doors behind you as you leave.',
      "3. Once you're out, stay out. Don't go back inside for any reason.",
      '4. Meet at a safe place away from the building and tell me if anyone is missing.',
    ),
  ],
  [
    'vehicle-fire-safety', 'FD', 'Vehicle fire safety',
    lines(
      '1. Get everyone out of the vehicle and well away from it, at least 100 feet (30 m), and stay upwind of the smoke.',
      "2. Don't open the hood and don't try to fight the fire.",
      '3. Keep other people back and stay away from the road.',
    ),
  ],
  [
    'co-evacuate', 'FD', 'Carbon monoxide: get to fresh air',
    lines(
      '1. Everyone leave the building now and go to fresh air. Open the door as you go.',
      "2. Don't go back inside, even for belongings, until the fire service says it is safe.",
      '3. Count everyone who got out and tell me if anyone is missing or feeling sick.',
    ),
  ],
  [
    'gas-leak-evacuate', 'FD', 'Gas leak: get out',
    lines(
      '1. Leave the building right away and get everyone out.',
      "2. Don't turn lights or switches on or off, don't use anything that could spark, and don't light a match.",
      "3. Don't use the phone inside the building. Stay on the line from outside if you can.",
      '4. Stay away from the building and keep other people back.',
    ),
  ],
  [
    'downed-lines', 'FD', 'Downed power lines',
    lines(
      '1. Stay at least 30 feet (10 m) away from the lines and anything touching them. Treat every wire as live.',
      "2. Don't touch a vehicle or person that is in contact with the lines.",
      '3. Keep other people away, and tell me if anything starts to burn.',
    ),
  ],
]

export function instructionRows(): Row[] {
  return INSTRUCTIONS.map(([id, type, title, script]) => [id, type, title, script, 'ROLEPLAY', SOURCE])
}
