import { Tree } from './dsl'

const P1 = 'Priority 1: Officers needed immediately. Send the highest-priority police response. Keep the caller on the line.'
const P2 = 'Priority 2: Urgent. Send the next available officers. Keep the caller on the line.'
const P3 = 'Priority 3: Routine. Create a report or send an officer when available; tell the caller to call back if anything changes.'
const YN = ['Yes', 'No']
const when = ['Under 5 minutes ago', '5 to 30 minutes ago', 'Over 30 minutes ago']
const t = (id: string, complaint: string, name: string) => new Tree(id, 'PD', complaint, `PD: ${name}`)

export function pdTrees(): Tree[] {
  return [
    t('pd-assault', 'Assault or reported violence', 'assault or reported violence')
      .term('p1', P1, 'pd-stay-safe')
      .term('p1-medical', `${P1} Also send medical help: someone is seriously hurt.`, 'pd-stay-safe')
      .term('p2', P2, 'pd-stay-safe')
      .term('p3', P3)
      .q({ id: 'now', text: 'Is the assault happening right now?', choices: YN, to: { Yes: 'q:hurt', No: 'q:ago' } })
      .q({ id: 'hurt', text: 'Is anyone seriously hurt or unconscious?', choices: YN, to: { Yes: 't:p1-medical', No: 'q:weapon' } })
      .q({ id: 'weapon', text: 'Does anyone involved have a weapon?', choices: YN, to: { Yes: 't:p1', No: 'q:desc', '(unknown)': 't:p1' } })
      .q({ id: 'ago', text: 'How long ago did it happen?', choices: when, to: Object.fromEntries(when.map((a) => [a, 'q:desc'])) })
      .q({ id: 'desc', text: 'Describe the person who did it: height, build, clothing, hair.', input: 'text', field: 'personsInvolved', to: { '(answered)': 'q:there', '(unknown)': 'q:there' } })
      .q({ id: 'there', text: 'Is that person still at the scene?', choices: YN, to: { Yes: 't:p2', No: 'q:left' } })
      .q({ id: 'left', text: 'Which way did they go, and were they on foot or in a vehicle?', input: 'text', to: { '(answered)': 't:p2', '(unknown)': 't:p3' } }),

    t('pd-domestic', 'Domestic disturbance', 'domestic disturbance')
      .term('p1', P1, 'pd-stay-safe')
      .term('p2', P2, 'pd-stay-safe')
      .term('p3', P3)
      .q({ id: 'hurt', text: 'Is anyone being hurt right now?', choices: YN, to: { Yes: 't:p1', No: 'q:threat' } })
      .q({ id: 'threat', text: 'Is anyone threatening to hurt someone, or is there a weapon in the home?', choices: YN, to: { Yes: 't:p1', No: 'q:kids', '(unknown)': 't:p1' } })
      .q({ id: 'kids', text: 'Are children in the home?', choices: YN, to: { Yes: 'q:there', No: 'q:there', '(unknown)': 'q:there' } })
      .q({ id: 'there', text: 'Is the person causing the problem still there?', choices: YN, to: { Yes: 't:p2', No: 't:p3' } }),

    t('pd-breakin', 'Break and enter', 'break and enter')
      .term('p1-inside', P1, 'pd-lock-and-wait')
      .term('p1', P1, 'pd-do-not-confront')
      .term('p3', P3, 'pd-do-not-confront')
      .q({ id: 'now', text: 'Is the break-in happening right now?', choices: YN, to: { Yes: 'q:inside', No: 'q:found' } })
      .q({ id: 'inside', text: 'Are you or anyone else inside the building right now?', choices: YN, to: { Yes: 't:p1-inside', No: 'q:see' } })
      .q({ id: 'see', text: 'Describe the person or people you can see.', input: 'text', field: 'personsInvolved', to: { '(answered)': 't:p1', '(unknown)': 't:p1' } })
      .q({ id: 'found', text: 'When did you find out about it?', choices: ['Just now', 'Within the last hour', 'Earlier today', 'Longer ago'], to: { 'Just now': 'q:stillin', 'Within the last hour': 'q:stillin', 'Earlier today': 'q:stillin', 'Longer ago': 'q:stillin' } })
      .q({ id: 'stillin', text: 'Could anyone still be inside?', choices: YN, to: { Yes: 't:p1', No: 't:p3', '(unknown)': 't:p1' } }),

    t('pd-theft', 'Theft or shoplifting', 'theft or shoplifting')
      .term('p2', P2)
      .term('p3', P3)
      .q({ id: 'there', text: 'Is the thief still there or in sight?', choices: YN, to: { Yes: 'q:desc', No: 'q:ago' } })
      .q({ id: 'desc', text: 'Describe the person: height, build, clothing, hair.', input: 'text', field: 'personsInvolved', to: { '(answered)': 'q:dir', '(unknown)': 'q:dir' } })
      .q({ id: 'dir', text: 'Which way are they going, and on foot or in a vehicle?', input: 'text', to: { '(answered)': 't:p2', '(unknown)': 't:p2' } })
      .q({ id: 'ago', text: 'When did it happen?', choices: ['Just now', 'Within the last hour', 'Earlier today', 'Longer ago'], to: { 'Just now': 'q:what', 'Within the last hour': 'q:what', 'Earlier today': 'q:what', 'Longer ago': 'q:what' } })
      .q({ id: 'what', text: 'What was taken, and about what is it worth?', input: 'text', to: { '(answered)': 't:p3', '(unknown)': 't:p3' } }),

    t('pd-collision', 'Traffic collision', 'traffic collision')
      .term('p1', `${P1} Also send medical help: someone is hurt.`, 'traffic-safety')
      .term('p2', P2, 'traffic-safety')
      .term('p3', P3, 'traffic-safety')
      .q({ id: 'hurt', text: 'Is anyone hurt?', choices: YN, to: { Yes: 't:p1', No: 'q:block', '(unknown)': 't:p1' } })
      .q({ id: 'block', text: 'Are the vehicles blocking the road or in danger of being hit?', choices: YN, to: { Yes: 't:p2', No: 'q:fled' } })
      .q({ id: 'fled', text: 'Has anyone left the scene, or does anyone seem to be impaired?', choices: YN, to: { Yes: 't:p2', No: 't:p3', '(unknown)': 't:p2' } }),

    t('pd-suspicious', 'Suspicious activity', 'suspicious activity')
      .term('p1', P1, 'pd-do-not-confront')
      .term('p2', P2, 'pd-do-not-confront')
      .term('p3', P3, 'pd-do-not-confront')
      .q({ id: 'what', text: 'What is the person or vehicle doing that seems suspicious?', input: 'text', to: { '(answered)': 'q:desc', '(unknown)': 'q:desc' } })
      .q({ id: 'desc', text: 'Describe the person or vehicle.', input: 'text', field: 'personsInvolved', to: { '(answered)': 'q:now', '(unknown)': 'q:now' } })
      .q({ id: 'now', text: 'Are they doing it right now?', choices: YN, to: { Yes: 'q:danger', No: 't:p3' } })
      .q({ id: 'danger', text: 'Have they threatened anyone, or do they have a weapon?', choices: YN, to: { Yes: 't:p1', No: 't:p2', '(unknown)': 't:p2' } }),

    t('pd-missing', 'Missing person', 'missing person')
      .term('p1', P1)
      .term('p2', P2)
      .q({ id: 'age', text: 'How old is the missing person?', choices: ['Under 12', '12 to 17', '18 to 64', '65 or older'], to: { 'Under 12': 't:p1', '12 to 17': 'q:risk', '18 to 64': 'q:risk', '65 or older': 'q:risk' } })
      .q({ id: 'risk', text: 'Does the person have a medical condition, dementia, or anything else that puts them at risk?', choices: YN, to: { Yes: 't:p1', No: 'q:seen', '(unknown)': 'q:seen' } })
      .q({ id: 'seen', text: 'When and where was the person last seen?', input: 'text', to: { '(answered)': 'q:desc', '(unknown)': 'q:desc' } })
      .q({ id: 'desc', text: 'Describe the person and what they were wearing.', input: 'text', field: 'personsInvolved', to: { '(answered)': 't:p2', '(unknown)': 't:p2' } }),

    t('pd-weapon', 'Weapon concern', 'weapon concern')
      .term('p1', P1, 'pd-stay-safe')
      .term('p1-hide', P1, 'pd-lock-and-wait')
      .term('p2', P2, 'pd-do-not-confront')
      .q({ id: 'see', text: 'Can you see the weapon right now?', choices: YN, to: { Yes: 'q:point', No: 'q:desc' } })
      .q({ id: 'point', text: 'Is the person threatening anyone with it?', choices: YN, to: { Yes: 't:p1', No: 'q:desc' } })
      .q({ id: 'desc', text: 'Describe the person and where they are.', input: 'text', field: 'personsInvolved', to: { '(answered)': 'q:safe', '(unknown)': 'q:safe' } })
      .q({ id: 'safe', text: 'Are you in a safe place right now?', choices: YN, to: { Yes: 't:p2', No: 't:p1-hide' } }),

    t('pd-shots', 'Shots heard', 'shots heard')
      .term('p1', P1, 'pd-stay-safe')
      .term('p2', P2, 'pd-stay-safe')
      .q({ id: 'saw', text: 'Did you see anyone shooting, or see anyone hurt?', choices: YN, to: { Yes: 't:p1', No: 'q:count' } })
      .q({ id: 'count', text: 'About how many shots did you hear, and how long ago?', input: 'text', to: { '(answered)': 'q:dir', '(unknown)': 'q:dir' } })
      .q({ id: 'dir', text: 'Which direction did the sound come from?', input: 'text', to: { '(answered)': 't:p2', '(unknown)': 't:p2' } }),

    t('pd-driving', 'Impaired or dangerous driving report', 'impaired or dangerous driving')
      .term('p1', P1, 'traffic-safety')
      .term('p2', P2, 'traffic-safety')
      .term('p3', P3)
      .q({ id: 'moving', text: 'Is the vehicle moving right now?', choices: YN, to: { Yes: 'q:veh', No: 'q:parked' } })
      .q({ id: 'veh', text: 'Describe the vehicle: color, make, and license plate if you can see it.', input: 'text', to: { '(answered)': 'q:road', '(unknown)': 'q:road' } })
      .q({ id: 'road', text: 'Which road and direction is it traveling?', input: 'text', to: { '(answered)': 'q:how', '(unknown)': 'q:how' } })
      .q({ id: 'how', text: 'How is it being driven?', choices: ['Weaving across lanes', 'Going very fast', 'Going the wrong way', 'Stopping and starting suddenly', 'Other'], to: { 'Weaving across lanes': 't:p2', 'Going very fast': 't:p2', 'Going the wrong way': 't:p1', 'Stopping and starting suddenly': 't:p2', Other: 't:p2' } })
      .q({ id: 'parked', text: 'Where is the vehicle stopped, and is the driver inside?', input: 'text', to: { '(answered)': 't:p3', '(unknown)': 't:p3' } }),

    t('pd-threats', 'Threats or harassment', 'threats or harassment')
      .term('p1', P1, 'pd-stay-safe')
      .term('p2', P2, 'pd-stay-safe')
      .term('p3', P3)
      .q({ id: 'there', text: 'Is the person who made the threat there now?', choices: YN, to: { Yes: 'q:weapon', No: 'q:harm' } })
      .q({ id: 'weapon', text: 'Does the person have a weapon?', choices: YN, to: { Yes: 't:p1', No: 't:p2', '(unknown)': 't:p1' } })
      .q({ id: 'harm', text: 'Has the person threatened to hurt you or someone else?', choices: YN, to: { Yes: 't:p2', No: 't:p3' } }),

    t('pd-general', '*', 'any other police complaint')
      .term('p1', P1, 'pd-stay-safe')
      .term('p2', P2)
      .term('p3', P3)
      .q({ id: 'danger', text: 'Is anyone in immediate danger or being hurt?', choices: YN, to: { Yes: 't:p1', No: 'q:now', '(unknown)': 't:p1' } })
      .q({ id: 'now', text: 'Is the problem happening right now?', choices: YN, to: { Yes: 'q:desc', No: 't:p3' } })
      .q({ id: 'desc', text: 'Describe anyone involved.', input: 'text', field: 'personsInvolved', to: { '(answered)': 't:p2', '(unknown)': 't:p2' } }),
  ]
}
