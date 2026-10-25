import { Tree } from './dsl'

const P1 = 'Priority 1: Respond immediately. Send the highest-priority fire-service response. Keep the caller on the line.'
const P2 = 'Priority 2: Urgent. Send a fire-service response. Keep the caller on the line.'
const P3 = 'Priority 3: Routine. Send a non-emergency fire-service response; tell the caller to call back if anything changes.'
const YN = ['Yes', 'No']
const t = (id: string, complaint: string, name: string) => new Tree(id, 'FD', complaint, `FD: ${name}`)

export function fdTrees(): Tree[] {
  const building = ['House or townhouse', 'Apartment building', 'Business or store', 'Industrial or warehouse', 'Other']
  return [
    t('fd-structure', 'Structure fire', 'structure fire')
      .term('p1-rescue', `${P1} People may be trapped: also send medical help.`, 'fire-evacuate')
      .term('p1', P1, 'fire-evacuate')
      .term('p2', P2, 'fire-evacuate')
      .term('p3', P3)
      .q({ id: 'trapped', text: 'Is anyone trapped inside, or not accounted for?', choices: YN, to: { Yes: 't:p1-rescue', No: 'q:flames', '(unknown)': 't:p1-rescue' } })
      .q({ id: 'flames', text: 'Can you see flames or smoke coming from the building?', choices: YN, to: { Yes: 'q:kind', No: 'q:smell' } })
      .q({ id: 'kind', text: 'What kind of building is it?', choices: building, to: Object.fromEntries(building.map((a) => [a, 't:p1'])) })
      .q({ id: 'smell', text: 'Do you smell smoke, or is an alarm sounding?', choices: YN, to: { Yes: 't:p2', No: 't:p3' } }),

    t('fd-vehicle', 'Vehicle fire', 'vehicle fire')
      .term('p1', P1, 'vehicle-fire-safety')
      .term('p2', P2, 'vehicle-fire-safety')
      .q({ id: 'inside', text: 'Is anyone inside the vehicle?', choices: YN, to: { Yes: 't:p1', No: 'q:near', '(unknown)': 't:p1' } })
      .q({ id: 'near', text: 'Is the vehicle close to a building or other vehicles?', choices: YN, to: { Yes: 't:p1', No: 'q:where' } })
      .q({ id: 'where', text: 'Is the fire in the engine area or is the whole vehicle burning?', choices: ['Engine area only', 'Whole vehicle'], to: { 'Engine area only': 't:p2', 'Whole vehicle': 't:p2' } }),

    t('fd-brush', 'Brush or grass fire', 'brush or grass fire')
      .term('p1', P1, 'fire-evacuate')
      .term('p2', P2)
      .term('p3', P3)
      .q({ id: 'homes', text: 'Is the fire close to homes or other buildings?', choices: YN, to: { Yes: 't:p1', No: 'q:size' } })
      .q({ id: 'size', text: 'About how large is the fire?', choices: ['Smaller than a car', 'Larger than a car, smaller than a house', 'Larger than a house'], to: { 'Smaller than a car': 'q:wind', 'Larger than a car, smaller than a house': 'q:wind', 'Larger than a house': 't:p1' } })
      .q({ id: 'wind', text: 'Is the wind pushing the fire toward anything?', choices: YN, to: { Yes: 't:p2', No: 't:p3', '(unknown)': 't:p2' } }),

    t('fd-smoke', 'Smoke or burning smell', 'smoke or burning smell')
      .term('p1', P1, 'fire-evacuate')
      .term('p2', P2, 'fire-evacuate')
      .term('p3', P3)
      .q({ id: 'see', text: 'Do you see smoke or flames?', choices: YN, to: { Yes: 'q:where', No: 'q:smell' } })
      .q({ id: 'where', text: 'Where is the smoke or fire coming from?', input: 'text', to: { '(answered)': 't:p1', '(unknown)': 't:p1' } })
      .q({ id: 'smell', text: 'Where do you smell it?', choices: ['Inside the building', 'Outside'], to: { 'Inside the building': 't:p2', Outside: 't:p3' } }),

    t('fd-alarm', 'Fire alarm activation', 'fire alarm activation')
      .term('p1', P1, 'fire-evacuate')
      .term('p2', P2)
      .term('p3', P3)
      .q({ id: 'signs', text: 'Does anyone report smoke, fire, or a burning smell?', choices: YN, to: { Yes: 't:p1', No: 'q:kind', '(unknown)': 'q:kind' } })
      .q({ id: 'kind', text: 'What kind of building is it?', choices: ['Home', 'Business', 'School or care facility', 'Other'], to: { Home: 't:p3', Business: 't:p3', 'School or care facility': 't:p2', Other: 't:p3' } }),

    t('fd-co', 'Carbon monoxide alarm', 'carbon monoxide alarm')
      .term('p1', P1, 'co-evacuate')
      .term('p2', P2, 'co-evacuate')
      .term('p3', P3, 'co-evacuate')
      .q({ id: 'sick', text: 'Is anyone feeling sick: headache, dizzy, nauseated or confused?', choices: YN, to: { Yes: 'q:out', No: 't:p3' } })
      .q({ id: 'out', text: 'Is anyone unconscious or not waking up?', choices: YN, to: { Yes: 't:p1', No: 't:p2' } }),

    t('fd-hazmat', 'Hazardous-material concern', 'hazardous-material concern')
      .term('p1', P1, 'fire-evacuate')
      .term('p2', P2)
      .q({ id: 'sick', text: 'Is anyone sick, coughing, or having burning eyes or skin?', choices: YN, to: { Yes: 't:p1', No: 'q:label' } })
      .q({ id: 'label', text: 'Can you tell what the substance is, from a label or sign? Do not go closer.', input: 'text', to: { '(answered)': 't:p2', '(unknown)': 't:p2' } }),

    t('fd-gas', 'Gas leak or odor', 'gas leak or odor')
      .term('p1', P1, 'gas-leak-evacuate')
      .term('p2', P2, 'gas-leak-evacuate')
      .term('p3', P3, 'gas-leak-evacuate')
      .q({ id: 'inside', text: 'Do you smell gas inside a building?', choices: YN, to: { Yes: 'q:sick', No: 't:p3' } })
      .q({ id: 'sick', text: 'Is anyone dizzy, sick, or feeling faint?', choices: YN, to: { Yes: 't:p1', No: 't:p2' } }),

    t('fd-rescue', 'Rescue or trapped person', 'rescue or trapped person')
      .term('p1', P1)
      .term('p2', P2)
      .q({ id: 'where', text: 'What is the person trapped in or under?', choices: ['Vehicle', 'Building or collapsed structure', 'Elevator', 'Water or ice', 'Machinery', 'Other'], to: { Vehicle: 'q:hurt', 'Building or collapsed structure': 't:p1', Elevator: 'q:hurt', 'Water or ice': 't:p1', Machinery: 't:p1', Other: 'q:hurt' } })
      .q({ id: 'hurt', text: 'Is the person hurt, or not responding?', choices: YN, to: { Yes: 't:p1', No: 't:p2', '(unknown)': 't:p1' } }),

    t('fd-electrical', 'Electrical hazard', 'electrical hazard')
      .term('p1', P1, 'downed-lines')
      .term('p2', P2, 'downed-lines')
      .q({ id: 'fire', text: 'Do you see sparks, smoke or flames from equipment or wiring?', choices: YN, to: { Yes: 't:p1', No: 'q:contact' } })
      .q({ id: 'contact', text: 'Is anyone touching a live wire, or hurt by electricity?', choices: YN, to: { Yes: 't:p1', No: 't:p2' } }),

    t('fd-lines', 'Downed power lines', 'downed power lines')
      .term('p1', P1, 'downed-lines')
      .term('p2', P2, 'downed-lines')
      .q({ id: 'touch', text: 'Are the lines touching a vehicle, a building, or a person?', choices: YN, to: { Yes: 't:p1', No: 'q:hurt' } })
      .q({ id: 'hurt', text: 'Is anyone hurt?', choices: YN, to: { Yes: 't:p1', No: 't:p2' } }),

    t('fd-collision', 'Vehicle collision requiring fire-service assistance', 'vehicle collision, fire-service assistance')
      .term('p1', P1, 'vehicle-fire-safety')
      .term('p2', P2)
      .term('p3', P3)
      .q({ id: 'trapped', text: 'Is anyone trapped in a vehicle?', choices: YN, to: { Yes: 't:p1', No: 'q:fuel', '(unknown)': 't:p1' } })
      .q({ id: 'fuel', text: 'Is there fire, smoke, or fuel leaking?', choices: YN, to: { Yes: 't:p1', No: 'q:hurt' } })
      .q({ id: 'hurt', text: 'Is anyone hurt?', choices: YN, to: { Yes: 't:p2', No: 't:p3' } }),

    t('fd-general', '*', 'any other fire-service call')
      .term('p1', P1, 'fire-evacuate')
      .term('p2', P2)
      .term('p3', P3)
      .q({ id: 'danger', text: 'Is anyone in danger or trapped?', choices: YN, to: { Yes: 't:p1', No: 'q:signs', '(unknown)': 't:p1' } })
      .q({ id: 'signs', text: 'Is there smoke, fire, or a hazardous smell?', choices: YN, to: { Yes: 't:p2', No: 't:p3' } }),
  ]
}
