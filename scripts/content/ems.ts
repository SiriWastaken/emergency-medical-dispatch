import { Tree } from './dsl'

const P1 = 'Priority 1: Immediate. Send the highest-priority medical response now. Stay on the line with the caller.'
const P2 = 'Priority 2: Urgent. Send an emergency medical response. Stay on the line with the caller.'
const P3 = 'Priority 3: Routine. Send a standard medical response and tell the caller to call back if anything changes.'
const ARREST = 'Priority 1: Immediate. Possible cardiac arrest: send the highest-priority medical response now and start CPR instructions. (For a baby under one year, use the infant CPR script.)'

const YN = ['Yes', 'No']

/**
 * The questions every medical call needs for the narrative, asked after the two life-threat questions.
 * Unconscious and not breathing goes straight to cardiac-arrest handling.
 */
function common(t: Tree, first: string): Tree {
  t.term('arrest', ARREST, 'cpr')
  t.q({ id: 'conscious', text: 'Is the patient awake and responding to you?', choices: ['Yes', 'No', 'Partly (confused or drowsy)'], field: 'consciousStatus', to: { Yes: 'q:breathing', No: 'q:breathing', 'Partly (confused or drowsy)': 'q:breathing', '(unknown)': 'q:breathing', '(unavailable)': 'q:breathing' } })
  t.q({
    id: 'breathing',
    text: 'Is the patient breathing?',
    choices: ['Yes, normally', 'Yes, but with difficulty', 'No'],
    field: 'breathingStatus',
    to: { 'Yes, normally': 'q:count', 'Yes, but with difficulty': 'q:count', No: 'q:count', '(unknown)': 'q:count', '(unavailable)': 'q:count' },
    when: [{ answer: 'No', cond: 'conscious=No', to: 't:arrest' }],
  })
  t.q({ id: 'count', text: 'How many people are hurt or sick?', input: 'integer', range: [1, 999], field: 'patientCount', to: { '(answered)': 'q:age', '(unknown)': 'q:age', '(unavailable)': 'q:age' } })
  t.q({ id: 'age', text: 'How old is the patient, in years? (Say 0 for a baby under one year.)', input: 'integer', range: [0, 120], field: 'patientAge', to: { '(answered)': 'q:sex', '(unknown)': 'q:sex', '(unavailable)': 'q:sex' } })
  t.q({ id: 'sex', text: 'Is the patient male or female?', choices: ['Male', 'Female', 'Other'], field: 'sex', to: { Male: 'q:relationship', Female: 'q:relationship', Other: 'q:relationship', '(unknown)': 'q:relationship', '(unavailable)': 'q:relationship' } })
  t.q({
    id: 'relationship',
    text: 'What is your relationship to the patient?',
    choices: ['Patient (calling about myself)', 'Family member', 'Friend or coworker', 'Bystander (stranger)', 'Other'],
    field: 'callerRelationship',
    to: Object.fromEntries(['Patient (calling about myself)', 'Family member', 'Friend or coworker', 'Bystander (stranger)', 'Other', '(unknown)', '(unavailable)'].map((a) => [a, `q:${first}`])),
  })
  return t
}

const tree = (id: string, complaint: string, name: string, first: string) => common(new Tree(id, 'EMS', complaint, name), first)

export function emsTrees(): Tree[] {
  const trees: Tree[] = []

  // ---- Cardiac arrest / unresponsive person
  trees.push(
    tree('ems-arrest', 'Cardiac arrest / unresponsive person', 'EMS: cardiac arrest / unresponsive person', 'collapse')
      .term('unresponsive-breathing', 'Priority 1: Immediate. Unresponsive patient who is breathing: send the highest-priority medical response and keep the airway clear.', 'recovery-position')
      .q({ id: 'collapse', text: 'Did you see or hear the patient collapse?', choices: YN, to: { Yes: 'q:heart', No: 'q:heart' } })
      .q({ id: 'heart', text: 'As far as you know, does the patient have a heart condition?', choices: YN, to: { Yes: 't:unresponsive-breathing', No: 't:unresponsive-breathing', '(unknown)': 't:unresponsive-breathing' } }),
  )

  // ---- Chest pain
  trees.push(
    tree('ems-chest', 'Chest pain or cardiac symptoms', 'EMS: chest pain or cardiac symptoms', 'pain')
      .term('p1', P1, 'chest-pain-care')
      .term('p2', P2, 'chest-pain-care')
      .q({ id: 'pain', text: 'Is the patient having chest pain or pressure right now?', choices: YN, to: { Yes: 'q:spread', No: 'q:heartmeds' } })
      .q({ id: 'spread', text: 'Is the pain spreading to the arm, jaw, neck or back?', choices: YN, to: { Yes: 't:p1', No: 'q:sweat' } })
      .q({ id: 'sweat', text: 'Is the patient sweating, sick to the stomach, or very short of breath?', choices: YN, to: { Yes: 't:p1', No: 'q:heartmeds' } })
      .q({ id: 'heartmeds', text: 'Does the patient have a known heart condition, or take heart medicine?', choices: YN, to: { Yes: 't:p2', No: 't:p2', '(unknown)': 't:p2' } }),
  )

  // ---- Breathing difficulty
  trees.push(
    tree('ems-breathing', 'Breathing difficulty', 'EMS: breathing difficulty', 'chokefirst')
      .term('choking', P1, 'choking')
      .term('p1', P1, 'breathing-care')
      .term('p2', P2, 'breathing-care')
      .term('p3', P3)
      .q({ id: 'chokefirst', text: 'Is the patient choking on food or an object?', choices: YN, to: { Yes: 't:choking', No: 'q:speak' } })
      .q({ id: 'speak', text: 'Can the patient speak a full sentence without stopping to breathe?', choices: YN, to: { Yes: 'q:wheeze', No: 't:p1' } })
      .q({ id: 'wheeze', text: 'Is the patient wheezing, or do they have asthma or lung disease?', choices: YN, to: { Yes: 'q:onset', No: 'q:onset' } })
      .q({ id: 'onset', text: 'Did this start suddenly, or has it been building over hours or days?', choices: ['Suddenly', 'Building over hours', 'Building over days'], to: { Suddenly: 't:p2', 'Building over hours': 't:p2', 'Building over days': 't:p3' } }),
  )

  // ---- Choking (no common block: help and instructions come first)
  trees.push(
    new Tree('ems-choking', 'EMS', 'Choking', 'EMS: choking')
      .term('adult', 'Priority 1: Immediate. Choking patient who cannot cough or speak: send the highest-priority medical response and give the choking script now.', 'choking')
      .term('infant', 'Priority 1: Immediate. Choking baby: send the highest-priority medical response and give the infant choking script now.', 'choking-infant')
      .term('partial', P2, 'breathing-care')
      .q({ id: 'cough', text: 'Can the patient cough, speak or cry?', choices: YN, to: { Yes: 't:partial', No: 'q:baby' } })
      .q({ id: 'baby', text: 'Is the patient a baby under one year old?', choices: YN, to: { Yes: 't:infant', No: 't:adult' } }),
  )

  // ---- Abdominal pain
  trees.push(
    tree('ems-abdominal', 'Abdominal pain', 'EMS: abdominal pain', 'blood')
      .term('p1', P1)
      .term('p2', P2)
      .term('p3', P3)
      .q({ id: 'blood', text: 'Is the patient vomiting blood, or passing black or bloody stool?', choices: YN, to: { Yes: 't:p1', No: 'q:severe' } })
      .q({ id: 'severe', text: 'Is the pain severe, or is the belly hard or swollen?', choices: YN, to: { Yes: 't:p2', No: 'q:pregnant' } })
      .q({ id: 'pregnant', text: 'Is the patient pregnant, or could they be?', choices: YN, to: { Yes: 't:p2', No: 't:p3', '(unknown)': 't:p3' } }),
  )

  // ---- Seizure
  trees.push(
    tree('ems-seizure', 'Seizure or convulsions', 'EMS: seizure or convulsions', 'now')
      .term('seizing', P1, 'seizure-care')
      .term('p1', P1, 'seizure-care')
      .term('p2', P2, 'seizure-care')
      .q({ id: 'now', text: 'Is the patient having a seizure right now?', choices: YN, to: { Yes: 't:seizing', No: 'q:repeat' } })
      .q({ id: 'repeat', text: 'Has the patient had more than one seizure, or has it lasted over five minutes?', choices: YN, to: { Yes: 't:p1', No: 'q:known' } })
      .q({ id: 'known', text: 'Does the patient have a known seizure disorder?', choices: YN, to: { Yes: 't:p2', No: 't:p2', '(unknown)': 't:p2' } }),
  )

  // ---- Stroke-like symptoms
  trees.push(
    tree('ems-stroke', 'Stroke-like symptoms', 'EMS: stroke-like symptoms', 'face')
      .term('p1', P1, 'stroke-care')
      .term('p2', P2, 'stroke-care')
      .q({ id: 'face', text: 'Is one side of the face drooping, or is the smile uneven?', choices: YN, to: { Yes: 'q:onset', No: 'q:arm' } })
      .q({ id: 'arm', text: 'Is one arm or leg weak or numb?', choices: YN, to: { Yes: 'q:onset', No: 'q:speech' } })
      .q({ id: 'speech', text: 'Is the speech slurred or confused, or can the patient not speak?', choices: YN, to: { Yes: 'q:onset', No: 't:p2' } })
      .q({ id: 'onset', text: 'When did the symptoms start, or when was the patient last seen normal?', input: 'text', to: { '(answered)': 't:p1', '(unknown)': 't:p1' } }),
  )

  // ---- Allergic reaction
  trees.push(
    tree('ems-allergic', 'Allergic reaction', 'EMS: allergic reaction', 'airway')
      .term('p1', P1, 'allergic-care')
      .term('p2', P2, 'allergic-care')
      .term('p3', P3)
      .q({ id: 'airway', text: 'Is the patient having trouble breathing, or is the throat or tongue swelling?', choices: YN, to: { Yes: 't:p1', No: 'q:hives' } })
      .q({ id: 'hives', text: 'Does the patient have hives, a rash, or swelling of the face or lips?', choices: YN, to: { Yes: 'q:injector', No: 't:p3' } })
      .q({ id: 'injector', text: 'Does the patient have a prescribed epinephrine auto-injector with them?', choices: YN, to: { Yes: 't:p2', No: 't:p2' } }),
  )

  // ---- Overdose or poisoning
  trees.push(
    tree('ems-overdose', 'Overdose or poisoning', 'EMS: overdose or poisoning', 'awake')
      .term('p1', P1, 'overdose-care')
      .term('p1-intent', 'Priority 1: Immediate. Possible intentional overdose: send the highest-priority medical response and keep the patient safe.', 'safety-suicide')
      .term('p2', P2, 'overdose-care')
      .q({ id: 'awake', text: 'Is the patient awake and able to talk to you?', choices: YN, to: { Yes: 'q:what', No: 't:p1' } })
      .q({ id: 'what', text: 'What did the patient take or swallow?', input: 'text', to: { '(answered)': 'q:when', '(unknown)': 'q:when' } })
      .q({ id: 'when', text: 'About how long ago?', choices: ['Under 1 hour', '1 to 6 hours', 'Over 6 hours', 'Not sure'], to: { 'Under 1 hour': 'q:onpurpose', '1 to 6 hours': 'q:onpurpose', 'Over 6 hours': 'q:onpurpose', 'Not sure': 'q:onpurpose' } })
      .q({ id: 'onpurpose', text: 'Was it taken on purpose to hurt themselves?', choices: YN, to: { Yes: 't:p1-intent', No: 't:p2', '(unknown)': 't:p1-intent' } }),
  )

  // ---- Bleeding
  trees.push(
    tree('ems-bleeding', 'Bleeding', 'EMS: bleeding', 'heavy')
      .term('p1', P1, 'bleeding-control')
      .term('p2', P2, 'bleeding-control')
      .term('p3', P3, 'bleeding-control')
      .q({ id: 'heavy', text: 'Is the bleeding heavy, spurting, or soaking through cloth?', choices: YN, to: { Yes: 't:p1', No: 'q:where' } })
      .q({ id: 'where', text: 'Where on the body is the bleeding?', choices: ['Head or face', 'Neck', 'Chest or belly', 'Arm or leg', 'Other'], to: { 'Head or face': 'q:pressure', Neck: 't:p1', 'Chest or belly': 't:p1', 'Arm or leg': 'q:pressure', Other: 'q:pressure' } })
      .q({ id: 'pressure', text: 'Is the bleeding slowing or stopping with firm pressure?', choices: YN, to: { Yes: 't:p3', No: 't:p2' } }),
  )

  // ---- Traumatic injury
  trees.push(
    tree('ems-trauma', 'Traumatic injury', 'EMS: traumatic injury', 'cause')
      .term('p1', P1, 'bleeding-control')
      .term('p1-spine', P1, 'do-not-move')
      .term('p2', P2)
      .term('p3', P3)
      .q({ id: 'cause', text: 'What happened?', choices: ['Vehicle collision', 'Fall', 'Assault', 'Sports or recreation', 'Cut or crush injury', 'Other'], to: Object.fromEntries(['Vehicle collision', 'Fall', 'Assault', 'Sports or recreation', 'Cut or crush injury', 'Other'].map((a) => [a, 'q:bleed'])) })
      .q({ id: 'bleed', text: 'Is the patient bleeding heavily?', choices: YN, to: { Yes: 't:p1', No: 'q:spine' } })
      .q({ id: 'spine', text: 'Does the patient have neck or back pain, numbness, or cannot move part of the body?', choices: YN, to: { Yes: 't:p1-spine', No: 'q:bone' } })
      .q({ id: 'bone', text: 'Is a bone visibly out of place, or is the pain severe?', choices: YN, to: { Yes: 't:p2', No: 't:p3' } }),
  )

  // ---- Fall
  trees.push(
    tree('ems-fall', 'Fall', 'EMS: fall', 'height')
      .term('p1', P1, 'do-not-move')
      .term('p2', P2, 'do-not-move')
      .term('p3', P3)
      .q({ id: 'height', text: 'How far did the patient fall?', choices: ['Ground level (standing height or less)', 'Less than 10 feet (3 m)', 'More than 10 feet (3 m)'], to: { 'Ground level (standing height or less)': 'q:head', 'Less than 10 feet (3 m)': 'q:head', 'More than 10 feet (3 m)': 't:p1' } })
      .q({ id: 'head', text: 'Did the patient hit their head or black out?', choices: YN, to: { Yes: 't:p2', No: 'q:move' } })
      .q({ id: 'move', text: 'Can the patient get up and move normally?', choices: YN, to: { Yes: 't:p3', No: 't:p2' } }),
  )

  // ---- Burns
  trees.push(
    tree('ems-burns', 'Burns', 'EMS: burns', 'cause')
      .term('p1', P1, 'burn-care')
      .term('p2', P2, 'burn-care')
      .term('p3', P3, 'burn-care')
      .q({ id: 'cause', text: 'What caused the burn?', choices: ['Fire or flames', 'Hot liquid or steam', 'Chemical', 'Electrical', 'Sun or other'], to: { 'Fire or flames': 'q:big', 'Hot liquid or steam': 'q:big', Chemical: 'q:big', Electrical: 't:p1', 'Sun or other': 'q:big' } })
      .q({ id: 'big', text: "Is the burn larger than the patient's palm, or on the face, hands, feet or groin?", choices: YN, to: { Yes: 't:p2', No: 't:p3' } }),
  )

  // ---- Pregnancy or childbirth
  trees.push(
    tree('ems-birth', 'Pregnancy or childbirth', 'EMS: pregnancy or childbirth', 'now')
      .term('p1-birth', 'Priority 1: Immediate. Delivery is imminent: send the highest-priority medical response and give the childbirth script.', 'childbirth-care')
      .term('p1', P1)
      .term('p2', P2)
      .q({ id: 'now', text: 'Is the baby coming right now, or is the patient feeling the urge to push?', choices: YN, to: { Yes: 'q:crown', No: 'q:weeks' } })
      .q({ id: 'crown', text: "Can you see the baby's head?", choices: YN, to: { Yes: 't:p1-birth', No: 't:p1-birth' } })
      .q({ id: 'weeks', text: 'How many weeks pregnant is she?', choices: ['37 weeks or more', 'Less than 37 weeks', 'Not sure'], to: { '37 weeks or more': 'q:bleed', 'Less than 37 weeks': 'q:bleed', 'Not sure': 'q:bleed' } })
      .q({ id: 'bleed', text: 'Is she bleeding heavily or in severe belly pain?', choices: YN, to: { Yes: 't:p1', No: 't:p2' } }),
  )

  // ---- Diabetic emergency
  trees.push(
    tree('ems-diabetic', 'Diabetic emergency', 'EMS: diabetic emergency', 'swallow')
      .term('p1', P1, 'recovery-position')
      .term('p2', P2, 'diabetic-care')
      .term('p3', P3)
      .q({ id: 'swallow', text: 'Is the patient awake and able to swallow safely?', choices: YN, to: { Yes: 'q:acting', No: 't:p1' } })
      .q({ id: 'acting', text: 'Is the patient confused, shaky, sweating, or acting strangely?', choices: YN, to: { Yes: 'q:known', No: 't:p3' } })
      .q({ id: 'known', text: 'Is the patient a known diabetic?', choices: YN, to: { Yes: 't:p2', No: 't:p2', '(unknown)': 't:p2' } }),
  )

  // ---- Suicidal thoughts or self-harm
  trees.push(
    tree('ems-selfharm', 'Suicidal thoughts or self-harm', 'EMS: suicidal thoughts or self-harm', 'with')
      .term('p1', P1, 'safety-suicide')
      .term('p2', P2, 'safety-suicide')
      .q({ id: 'with', text: 'Is the patient with you right now?', choices: YN, to: { Yes: 'q:means', No: 'q:where' } })
      .q({ id: 'where', text: 'Where is the patient right now, and can you reach them?', input: 'text', to: { '(answered)': 'q:means', '(unknown)': 't:p1' } })
      .q({ id: 'means', text: 'Does the patient have a weapon, or have they taken anything?', choices: YN, to: { Yes: 't:p1', No: 'q:hurt', '(unknown)': 't:p1' } })
      .q({ id: 'hurt', text: 'Has the patient hurt themselves?', choices: YN, to: { Yes: 't:p1', No: 't:p2' } }),
  )

  // ---- Any other medical complaint
  trees.push(
    tree('ems-general', '*', 'EMS: any other medical complaint', 'problem')
      .term('p2', P2)
      .term('p3', P3)
      .q({ id: 'problem', text: 'What is the main problem the patient is having?', input: 'text', to: { '(answered)': 'q:worse', '(unknown)': 'q:worse' } })
      .q({ id: 'worse', text: 'Is the patient getting worse quickly?', choices: YN, to: { Yes: 't:p2', No: 'q:fever' } })
      .q({ id: 'fever', text: 'Does the patient have a fever, vomiting, or pain?', choices: YN, to: { Yes: 't:p3', No: 't:p3' } }),
  )
  return trees
}
