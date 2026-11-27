/*
 * Cocoahead forms — the one place that says what each form asks and where each
 * answer goes in the master Google Sheet. To add a question: add a field here,
 * and (if it needs a new column) add the column to the Sheet with the same name.
 *
 * Field types: ferment, ref, text, textarea, number, date, time, choice, chips, temps, yesno, repeat, photo
 *   (photo, P4-A: {type:'photo', max: 1}: the camera; the draft keeps only [photo_id], toOps writes no column for it; docs/photos.js)
 * Lists (choices) come from the "Lists" tab of the Sheet; DEFAULT_LISTS is used until
 * the phone has synced once.
 *
 * Groundwork for the roasting and chocolate forms (none of the five forms below uses it yet):
 *   form.area      'fermentation' | 'roasting' | 'making': who sees the form (ROLE_AREAS; Code.gs checks the same; 'chocolate' still reads as 'making')
 *   form.group     the heading it sits under on the home screen (forms not in the app's usual groups)
 *   form.makes(d)  [{kind, id, item}] things this entry creates, so pickers offer them before the Sheet has them
 *   form.marks(d)  [{kind, id, set, add}] changes it makes to things already known (a winnow sets nib_lbs; a pack adds to packed_lbs)
 *   form.prepare(d, ctx, prev) runs each time Save is finally tapped and returns values to add to the answers before
 *                  toOps (device-made IDs). prev: the answers already stored on this device under the same entry ID
 *                  (labels may be printed): their IDs are kept and only extra rows get new ones. Without prev they are
 *                  worked out again, so an edit after a failed save never sends stale IDs.
 *   form.preparedProblem(d) '' or why the prepared IDs do not fit the answers (toOps refuses the same).
 *                  Number new IDs from ctx.taken(kind) (every ID ever used, removed ones too), not ctx.known(kind)
 *                  (only what is open), so numbering never starts again after a sync
 *   form.check(d, ctx) → {errors: [{key,msg}], warnings: [{key,msg}]} checks that need other records
 *   field.type 'ref' with of: 'roast' | 'package' | 'batch' | 'shipment', open(item, ctx) to choose what is offered,
 *                  multiple: true for a list of them, itemText(item, ctx) for the label
 *   field.now      a "Now" button beside a time field
 *   field.default  may also be a function (d, ctx)
 *   field.dependsOn the key of the field whose change works this default out again (e.g. 'ferment')
 *   form.live      {after: field key, text(d, ctx)}: a line worked out from the answers, redrawn as they are typed (Start batch's nib : sugar)
 *   field.readonly shown, not typed
 *   field.paperNote the small note under the label on the paper form (fields with showIf)
 *   field.fold     true: an optional question the field app keeps under "More details (n)" until asked for (looks only: the
 *                  answer, its column and toOps are unchanged; a form folds only when two or more of its questions do; never inside a list of cards)
 */
(function (root) {
  'use strict';

  var DEFAULT_LISTS = {
    // Farms, stations and people come from the Sheet's Lists tab once the phone has synced.
    // They are left empty here because this code is public; only generic choices live in the code.
    'Farm': [],
    'Station': [],
    'Box type': ['Standard box', 'Small mango wood box'],
    'Paid to': [],
    'Addition': ['Mango', 'Banana leaves'],
    'Colour': ['White', 'Cream', 'Yellow', 'Peach', 'Pink', 'Purple', 'Beige', 'Light brown', 'Milk chocolate brown', 'Red brown', 'Dark red'],
    'Smell': ['Fresh pulp', 'Sweet', 'Fruity', 'Apple / cider', 'Alcohol', 'Calvados / brandy', 'Vinegar', 'Sweet vinegar', 'Balsamic', 'Champagne vinegar', 'Acid', 'Funk'],
    'Ridges (cut test)': ['F0', 'F1', 'F2', 'F3'],
    'Centre colour': ['Pale', 'Light purple', 'Bright purple', 'Dark purple', 'Brown'],
    'Drying location': ['Tent', 'Gazebo', 'Greenhouse', 'Round house', 'Under galvanized roof, wire trays', 'Sun', 'Drawer'],
    // P1-C: the Drying check's one question about the outside. Jake may add a step, but the word "Dry" must stay: the drying flags count the days until it.
    'Outside of beans': ['Wet', 'Sticky', 'Dry'],
    'Drying setup type': ['Tent', 'Drawers'], // P1-C: the optional "Setup" question (off until switched on)
    'Weather': ['Full sun', 'Partly sunny', 'Cloudy', 'Rain', 'Rain at night'],
    'Mold or bloom': ['None', 'Slight bloom', 'Slight mold', 'Persistent mold'],
    'Problem': ['Maggots or bugs', 'Mold', 'Grey or black beans', 'Bottom cold', 'Too wet'],
    'Current season': [],
    'Drying treatment': ['Polished', 'Polished with Ghostpo', 'Citrus rub'],
    'Person': [],
    // Roasting (stage 2). Empty lists hide their question on the tablet until Jake fills them on the Lists page.
    'Roaster': [],
    'Roast plan': [],
    'Package type': ['Vacuum bag', 'Box'], // nibs are vacuum-sealed and boxed
    'Standard package lbs': ['30'], // the usual weight of one package; its first entry fills in the Pack form (P2-A: 30 lb until Jake sets his own on the Lists page)
    'Carrier': [],
    // P2-A (the roasting redesign): the same lists and starting answers as Code.gs CFG.LISTS. Jake edits them on the Lists page.
    'Bean size': ['Small', 'Medium', 'Large'],
    'Port': [], // the destination port of a pallet: its first entry is filled in
    'Used for': ['Local sale', 'Samples', 'Kitchen'], // what a package kept for local use went to
    'Label copies': ['2'], // labels printed per package (bag and box)
    'Packages per pallet': [], // empty: no counter on the pallet
    // Making (stage 3). The first entry of 'Batch destination' is the form's starting answer.
    'Arrival check': ['OK', 'Not OK'], // the words for smell, taste and look when a package arrives; Jake can change them on the Lists page
    'Batch destination': ['Chocolate', 'Cocoa butter', 'Tea balls', 'Other'],
    // Tasting notes (2.4.0). The flavour words and what was tasted are editable on the Lists page.
    'Tasting sample': ['Beans', 'Nibs', 'Liquor', 'Chocolate'],
    'Flavour': ['Fruity', 'Nutty', 'Floral', 'Earthy', 'Acidic', 'Bitter', 'Smoky', 'Musty'],
  };

  var TEMP_RANGE = { min: 15, max: 65 };
  // Moisture meter readings, %: anything from 0 to 100 can be typed; a reading outside the usual range for beans gets a "looks unusual" check.
  var MOISTURE = { min: 0, max: 100, warnMin: 3, warnMax: 70 };

  // Areas of the work, and the areas each role works in (the same as CFG.ROLE_AREAS in Code.gs; a test checks).
  // 2.0.0: the third area is "making" (it was "chocolate"; areaKey() still reads the old word). People can have several areas.
  var AREAS = ['fermentation', 'roasting', 'making'];
  var ROLE_AREAS = { 'field': ['fermentation'], 'factory': ['roasting'], 'walpole': ['making'], 'viewer': [], 'admin': ['fermentation', 'roasting', 'making'] };
  // The words for each area come from config.js (CH_CONFIG.areas, the same as Code.gs CFG.AREA_NAMES), so a company can rename them there.
  var CFG_AREAS = (root.CH_CONFIG && root.CH_CONFIG.areas) || {};
  var AREA_TITLES = { fermentation: CFG_AREAS.fermentation || 'Fermentation', roasting: CFG_AREAS.roasting || 'Roasting', making: CFG_AREAS.making || 'Making' };
  function areaKey(a) { var w = String(a || '').trim().toLowerCase(); if (w === 'chocolate' || w === 'chocolate making') w = 'making'; return AREAS.indexOf(w) >= 0 ? w : ''; }
  // Things the general picker (field type 'ref') can offer: where the Sheet keeps them and what the lists answer calls them.
  var KINDS = {
    roast: { tab: 'Roasts', list: 'roasts', noun: 'Roast' },
    package: { tab: 'Packages', list: 'packages', noun: 'Package' },
    shipment: { tab: 'Shipments', list: 'shipments', noun: 'Pallet' }, // P2-E: a shipment is one pallet
    batch: { tab: 'Batches', list: 'batches', noun: 'Batch' },
  };

  function join(list) { return (list || []).filter(Boolean).join(', '); }
  function num(v) { return v === '' || v === null || v === undefined || isNaN(Number(v)) ? '' : Number(v); }
  function money(lbs, price) { return num(lbs) !== '' && num(price) !== '' ? Math.round(lbs * price * 100) / 100 : ''; }

  function deliveryFields() {
    return [
      { key: 'farm', label: 'Farm', type: 'choice', list: 'Farm', required: true, pickerLabel: 'All farms…' },
      { key: 'paid_to', label: 'Paid to', type: 'choice', list: 'Paid to', help: 'Leave blank for own beans.', pickerLabel: 'All names…', noneLabel: 'No one (own beans)' },
      // P1-A: each bucket weighed and added one by one; Wet beans and Buckets are then worked out from the list (sumInto, countInto)
      // and shown read-only. Leaving the list empty and typing the total works as before.
      { key: 'bucket_weights', label: 'Weigh bucket by bucket', type: 'buckets', unit: 'lbs', min: 0.1, max: 150, warnMax: 80, maxItems: 60, sumInto: 'lbs', countInto: 'buckets', help: 'Type each bucket and tap Add. Or skip this and type the total below.' },
      { key: 'lbs', label: 'Wet beans', type: 'number', unit: 'lbs', required: true, min: 1, max: 3000, warnMin: 10, warnMax: 1200, sumOf: 'bucket_weights' },
      { key: 'buckets', fold: true, label: 'Buckets', type: 'number', min: 0, max: 60, countOf: 'bucket_weights' },
      { key: 'price', label: 'Price per lb', type: 'number', unit: 'XCD', min: 0, max: 20, warnMax: 6, step: 0.05 },
      { key: 'pick_dates', fold: true, label: 'Pick dates', type: 'text', placeholder: 'e.g. 4/28, 4/29' },
    ];
  }

  /**
   * P1-A: the bucket weights of a delivery (d.bucket_weights), as text: trimmed, a comma read as a dot, blanks dropped.
   * A draft or entry from before buckets has none: []. The list is the record of what was weighed; Wet lbs is its sum.
   */
  function bucketList(d) {
    var v = d && d.bucket_weights;
    return (Array.isArray(v) ? v : []).map(function (x) { return x === null || x === undefined ? '' : String(x).trim().replace(',', '.'); }).filter(function (x) { return x !== ''; });
  }
  /** The total of a bucket list, to 2 decimals (0.1 + 0.2 is 0.3, never 0.30000000000000004). */
  function bucketSum(list) {
    var t = (list || []).reduce(function (s, x) { return s + Number(x); }, 0);
    return Math.round(t * 100) / 100;
  }
  var BUCKET_NUM = /^(\d+(\.\d{0,2})?|\.\d{1,2})$/; // a plain weight: 23, 23.5, 23.45, .5 (no signs, no letters; at most 2 decimals)
  var BUCKET_DECIMALS = /^\d*\.\d{3,}$/; // 23.456: a weight with more than 2 decimals (refused with its own words)

  function intakeRow(fid, date, d) {
    var b = bucketList(d);
    // With buckets, Wet lbs and Buckets come from the list (a stray typed total is ignored); without, exactly as before.
    var lbs = b.length ? bucketSum(b) : num(d.lbs);
    var row = {
      'Ferment ID': fid, 'Date added': date, 'Pick dates': d.pick_dates || '', 'Farm': d.farm,
      'Paid to': d.paid_to || '', 'Wet lbs': lbs, 'Buckets': b.length ? b.length : num(d.buckets),
      'Price per lb (XCD)': num(d.price), 'Amount paid (XCD)': money(lbs, d.price), 'Note': d.note || '',
    };
    if (b.length) row['Bucket weights'] = b.join(', '); // only sent with buckets (text, even for one), so an entry without is as before
    return row;
  }

  function interior(d) {
    var parts = [];
    if (d.ridges && d.ridges.length) parts.push(join(d.ridges));
    if (d.centre_colour && d.centre_colour.length) parts.push('centres ' + join(d.centre_colour).toLowerCase());
    return parts.join('; ');
  }

  /** The box the beans moved into. Older drafts saved the turn number instead (box = turn + 1). */
  function boxOf(d) {
    if (num(d.box) !== '') return Number(d.box);
    if (num(d.turn) !== '') return Number(d.turn) + 1;
    return '';
  }

  var FORMS = [
    {
      id: 'new_ferment', area: 'fermentation', title: 'New ferment', hint: 'Load a box',
      fields: [
        { key: 'ferment', label: 'Ferment ID', type: 'text', required: true, default: 'nextFermentId', pattern: '^\\d+\\.\\d+$', patternHelp: 'Season, then number: like 2.17', inputmode: 'decimal' },
        { key: 'date', label: 'Load date', type: 'date', default: 'today', required: true },
        { key: 'time', label: 'Load time', type: 'time', default: 'now' },
        { key: 'station', label: 'Station', type: 'choice', list: 'Station' },
        { key: 'box_type', label: 'Box type', type: 'choice', list: 'Box type' },
        // Optional: which turning schedule this ferment tries (e.g. daily, every other day). The list is on the Lists tab;
        // with nothing on it the question is not shown.
        { key: 'plan', fold: true, label: 'Ferment plan', type: 'choice', list: 'Ferment plan', hideIfEmpty: true, noneLabel: 'Not set', help: 'Optional: the turning schedule this ferment follows.' },
        { key: 'deliveries', label: 'Beans in the box', type: 'repeat', itemLabel: 'Delivery', min: 1, fields: deliveryFields() },
        { key: 'juice', fold: true, label: 'Juice taken', type: 'number', min: 0, max: 200 },
        { key: 'juice_unit', fold: true, label: 'Juice unit', type: 'choice', options: ['lbs', 'litres', 'gallons'], requiredIf: function (d) { return num(d.juice) !== ''; }, help: 'Weighed in lbs is best: it compares directly with the beans.' },
        { key: 'brix', fold: true, label: 'Brix', type: 'number', unit: '°Bx', min: 0, max: 40, warnMin: 8, warnMax: 25, step: 0.1 },
        { key: 'additions', fold: true, label: 'Added to the box', type: 'chips', list: 'Addition' },
        { key: 'notes', fold: true, label: 'Notes', type: 'textarea', placeholder: 'Weather while picking, pod age, anything unusual' },
      ],
      summary: function (d) { return 'Ferment ' + d.ferment + ' · ' + (d.deliveries || []).reduce(function (s, x) { return s + (Number(x.lbs) || 0); }, 0) + ' lbs'; },
      toOps: function (d) {
        var f = {
          'Ferment ID': d.ferment, 'Station': d.station || '', 'Box type': d.box_type || '',
          'Load date': d.date, 'Load time': d.time || '', 'Brix': num(d.brix),
          'Additions': join(d.additions), 'Notes': d.notes || '',
        };
        if (d.plan) f['Ferment plan'] = d.plan; // only sent when picked, so older Sheets without the column are fine
        if (num(d.juice) !== '') f[{ lbs: 'Juice lbs', litres: 'Juice litres', gallons: 'Juice gallons' }[d.juice_unit]] = num(d.juice);
        var ops = [{ op: 'append', tab: 'Ferments', row: f }];
        (d.deliveries || []).forEach(function (x) { ops.push({ op: 'append', tab: 'Intakes', row: intakeRow(d.ferment, d.date, x) }); });
        return ops;
      },
    },
    {
      id: 'ferment_check', area: 'fermentation', title: 'Ferment check', hint: 'Move to next box or unload',
      fields: [
        { key: 'ferment', label: 'Ferment', type: 'ferment', required: true },
        { key: 'date', label: 'Date', type: 'date', default: 'today', required: true },
        { key: 'time', label: 'Time', type: 'time', default: 'now' },
        // Saved as Stage "Turn" (as before) so old and new ferments line up; shown as moving the beans to the next box.
        { key: 'stage', label: 'What are you doing?', type: 'choice', options: ['Turn', 'Unload', 'Check'], optionLabels: { Turn: 'Move to next box' }, default: 'Turn', required: true },
        // Box 1 is the box the beans are loaded into; each move goes one box on. Saved as Turn # = box − 1.
        { key: 'box', label: 'Moving the beans into box', type: 'number', min: 2, max: 13, default: 'nextBox', inputmode: 'numeric', help: 'Filled in for you: the next box after the last move.', paperNote: 'Only when moving to the next box', showIf: function (d) { return d.stage === 'Turn'; } },
        { key: 'top', label: 'Top temperatures', type: 'temps', unit: '°C', help: 'Up to five probe readings near the top.' },
        { key: 'centre', label: 'Centre temperatures', type: 'temps', unit: '°C', help: 'Up to five probe readings in the centre.' },
        { key: 'colour', label: 'Colour', type: 'chips', list: 'Colour', pickerLabel: 'All colours…' },
        { key: 'smell', label: 'Smell', type: 'chips', list: 'Smell', pickerLabel: 'All smells…' },
        { key: 'ridges', fold: true, label: 'Cut test: ridges', type: 'chips', list: 'Ridges (cut test)' },
        { key: 'centre_colour', fold: true, label: 'Cut test: centre colour', type: 'chips', list: 'Centre colour' },
        { key: 'problems', fold: true, label: 'Problems seen', type: 'chips', list: 'Problem' },
        { key: 'added', fold: true, label: 'Added to the box today', type: 'chips', list: 'Addition' },
        { key: 'drying_setup', label: 'Spread to dry where?', type: 'chips', list: 'Drying location', pickerLabel: 'All places…', default: 'stationList', paperNote: 'Only when unloading', showIf: function (d) { return d.stage === 'Unload'; } },
        { key: 'notes', fold: true, label: 'Notes', type: 'textarea', placeholder: 'Mold, bugs, banana leaves added, anything unusual' },
      ],
      summary: function (d) { return 'Ferment ' + d.ferment + ' · ' + (d.stage === 'Turn' ? 'moved to box ' + (boxOf(d) || '?') : d.stage); },
      confirm: function (d) { return d.stage === 'Unload' ? 'This records ferment ' + d.ferment + ' as unloaded on ' + d.date + '. Is that right?' : ''; },
      toOps: function (d) {
        var row = {
          'Ferment ID': d.ferment, 'Date': d.date, 'Time': d.time || '', 'Stage': d.stage,
          'Turn #': d.stage === 'Turn' && boxOf(d) ? boxOf(d) - 1 : '', 'Colour': join(d.colour), 'Smell': join(d.smell),
          'Interior (cut test)': interior(d), 'Problems': join(d.problems), 'Added': join(d.added), 'Notes': d.notes || '',
        };
        for (var i = 0; i < 5; i++) {
          row['Top ' + (i + 1) + ' °C'] = num((d.top || [])[i]);
          row['Centre ' + (i + 1) + ' °C'] = num((d.centre || [])[i]);
        }
        var ops = [{ op: 'append', tab: 'Ferment checks', row: row }];
        if (d.stage === 'Unload') {
          ops.push({ op: 'update', tab: 'Ferments', key: d.ferment, set: { 'Unload date': d.date, 'Unload time': d.time || '', 'Drying setup': join(d.drying_setup) } });
        }
        return ops;
      },
    },
    {
      id: 'drying_check', area: 'fermentation', title: 'Drying check', hint: 'Daily on the racks',
      fields: [
        { key: 'ferment', label: 'Ferment', type: 'ferment', required: true },
        { key: 'date', label: 'Date', type: 'date', default: 'today', required: true },
        { key: 'location', label: 'Where are the beans?', type: 'choice', list: 'Drying location', pickerLabel: 'All places…', default: 'dryingPlace', help: 'Beans split between places? Save one check for each place.' },
        { key: 'setup', label: 'Setup', type: 'choice', list: 'Drying setup type' }, // P1-C: optional, off until a company switches it on
        { key: 'weather', label: 'Weather today', type: 'choice', list: 'Weather' },
        // 1.30.0: the tent's own readings (Jake, 25 Nov). Optional numbers, sent only when typed, so an older script files every other entry
        { key: 'tent_temp', label: 'Temperature in tent', type: 'number', unit: '°C', min: 0, max: 70, warnMin: 15, warnMax: 55, step: 0.1, inputmode: 'decimal', help: 'Leave empty if the beans are not in a tent.' },
        { key: 'tent_humidity', label: 'Humidity in tent', type: 'number', unit: '%', min: 0, max: 100, warnMin: 20, warnMax: 99, step: 1, inputmode: 'decimal' },
        { key: 'outside', label: 'Outside of beans', type: 'choice', list: 'Outside of beans' }, // P1-C: the one plain question (column Exterior state)
        { key: 'exterior', label: 'Outside dry (%)', type: 'choice', options: ['0%', '25%', '50%', '75%', '100%'] }, // the old question: optional, off by default (P1-C)
        { key: 'sticky', label: 'Sticky to touch?', type: 'yesno' }, // optional, off by default (P1-C)
        { key: 'mold', label: 'Mold or bloom', type: 'choice', list: 'Mold or bloom' },
        { key: 'treatment', fold: true, label: 'Done today', type: 'chips', list: 'Drying treatment' },
        { key: 'inside', fold: true, label: 'Inside of beans (cut one open)', type: 'choice', options: ['Wet', 'Slightly moist', 'Dry'] },
        { key: 'speed', fold: true, label: 'Drying speed', type: 'choice', options: ['Too fast', 'Good', 'Too slow'] },
        // catalog: optional. Moisture day by day: the dashboard draws these readings as a curve (2.4.0: 0 to 100, a warning outside the usual MOISTURE range)
        { key: 'moisture', label: 'Moisture meter reading', type: 'number', unit: '%', min: MOISTURE.min, max: MOISTURE.max, warnMin: MOISTURE.warnMin, warnMax: MOISTURE.warnMax, step: 0.1, inputmode: 'decimal',
          help: 'The number on the moisture meter, 0 to 100. Once the outside is dry, take a reading every day until it reads 6–8%.' },
        { key: 'notes', fold: true, label: 'Notes', type: 'textarea' },
      ],
      summary: function (d) { return 'Ferment ' + d.ferment + ' · drying' + (d.outside ? ' · outside ' + d.outside : d.exterior ? ' · ' + d.exterior + ' dry' : ''); },
      // P1-C: once the outside is dry, a nudge for the meter reading. A warning only: a second Save goes through. Not shown when the
      // meter question is switched off (validate leaves out messages about hidden questions).
      check: function (d) {
        var out = { errors: [], warnings: [] };
        if (String(d.outside || '').trim().toLowerCase() === 'dry' && num(d.moisture) === '') out.warnings.push({ key: 'moisture', msg: 'The outside is dry. Add today\'s meter reading if you have the meter.' });
        return out;
      },
      toOps: function (d) {
        var row = {
          'Ferment ID': d.ferment, 'Date': d.date, 'Location': d.location || '', 'Weather': d.weather || '',
          'Exterior dry %': d.exterior ? Number(String(d.exterior).replace('%', '')) : '',
          'Sticky': d.sticky || '', 'Mold or bloom': d.mold || '', 'Treatment': join(d.treatment),
          'Moisture %': num(d.moisture), 'Inside dryness': d.inside || '', 'Drying speed': d.speed || '', 'Observation': d.notes || '',
        };
        // P1-C: sent only when answered, so an older script (without these columns) still files every entry that does not use them
        if (d.outside) row['Exterior state'] = d.outside;
        if (d.setup) row['Drying setup type'] = d.setup;
        if (num(d.tent_temp) !== '') row['Tent temp °C'] = num(d.tent_temp); // 1.30.0
        if (num(d.tent_humidity) !== '') row['Tent humidity %'] = num(d.tent_humidity);
        return [{ op: 'append', tab: 'Drying log', row: row }];
      },
    },
    {
      id: 'add_beans', area: 'fermentation', title: 'Add beans', hint: 'More beans into a box',
      fields: [
        { key: 'ferment', label: 'Ferment', type: 'ferment', required: true },
        { key: 'date', label: 'Date added', type: 'date', default: 'today', required: true },
      ].concat(deliveryFields()).concat([{ key: 'note', fold: true, label: 'Notes', type: 'textarea' }]),
      summary: function (d) { return 'Ferment ' + d.ferment + ' · +' + d.lbs + ' lbs ' + (d.farm || ''); },
      toOps: function (d) { return [{ op: 'append', tab: 'Intakes', row: intakeRow(d.ferment, d.date, d) }]; },
    },
    {
      id: 'finish_drying', area: 'fermentation', title: 'Finish drying', hint: 'Weigh and bag',
      fields: [
        { key: 'ferment', label: 'Ferment', type: 'ferment', required: true },
        { key: 'exterior_date', fold: true, label: 'Outside fully dry on', type: 'date' },
        { key: 'interior_date', fold: true, label: 'Inside fully dry on', type: 'date' },
        { key: 'moisture', label: 'Final moisture', type: 'number', unit: '%', min: 0, max: 30, warnMin: 4, warnMax: 9, step: 0.1, help: 'Target 6–8%.' },
        // P1-C: the cut test after drying (the ferment check's two lists and a note). Optional, on by default, never required.
        { key: 'cut_ridges', label: 'Cut test: ridges', type: 'chips', list: 'Ridges (cut test)', help: 'Cut a few beans every time you finish drying.' },
        { key: 'cut_centre', label: 'Cut test: centre colour', type: 'chips', list: 'Centre colour' },
        { key: 'cut_note', fold: true, label: 'Cut test note', type: 'text' },
        { key: 'dry_lbs', label: 'Dry weight', type: 'number', unit: 'lbs', required: true, min: 1, max: 2000, warnMin: 10 },
        { key: 'bagged_date', label: 'Bagged on', type: 'date', default: 'today' },
        { key: 'bags', label: 'Number of bags', type: 'number', min: 1, max: 100 },
        { key: 'bag_labels', label: 'Written on the bags', type: 'text', default: 'fermentId', help: 'Write the ferment ID on every bag, so the beans can be traced later.' },
        { key: 'notes', fold: true, label: 'Notes', type: 'textarea' },
      ],
      summary: function (d) { return 'Ferment ' + d.ferment + ' · ' + d.dry_lbs + ' lbs dry'; },
      confirm: function (d) { return 'This marks ferment ' + d.ferment + ' as finished: ' + d.dry_lbs + ' lbs dry' + (d.bagged_date ? ', bagged ' + d.bagged_date : '') + '. Is that right?'; },
      toOps: function (d) {
        var ops = [{ op: 'update', tab: 'Ferments', key: d.ferment, set: {
          'Exterior dry date': d.exterior_date || '', 'Interior dry date': d.interior_date || '',
          'Final moisture %': num(d.moisture), 'Dry lbs': num(d.dry_lbs), 'Bagged date': d.bagged_date || '',
          'Bags': num(d.bags), 'Bag labels': d.bag_labels || '',
        } }];
        // P1-C: the cut test, only when filled in (an older script lacks these columns; an empty one leaves the cells as they are)
        var picked = function (x) { return (x || []).filter(Boolean); };
        var cut = interior({ ridges: picked(d.cut_ridges), centre_colour: picked(d.cut_centre) });
        if (cut) ops[0].set['Cut test (after drying)'] = cut;
        if (String(d.cut_note || '').trim()) ops[0].set['Cut test note'] = String(d.cut_note).trim();
        if (d.notes) ops.push({ op: 'append', tab: 'Drying log', row: { 'Ferment ID': d.ferment, 'Date': d.bagged_date || d.interior_date || '', 'Observation': 'Finished drying: ' + d.notes, 'Moisture %': num(d.moisture) } });
        return ops;
      },
    },
  ];


  /* ---------------- Roasting (stage 2): Roast, Winnow, Pack, Ship ----------------
   * ASSUMPTIONS (Jake has not answered yet; each is a one-line change, see README "Roasting"):
   *   A1 one package holds one roast's nibs (R3.1-P1); P2-A: a roast can take beans from several ferments ("Beans from")
   *   A5 lbs and °C; winnowing happens once per roast        A2 dry-bean bags are not tracked one by one
   *   A8 every "looks unusual" limit below is a starting guess (the numbers in LIMITS)
   */
  var LIMITS = {
    beansIn: { min: 1, max: 500 },                 // lbs into the roaster
    startTemp: { min: 40, max: 250 }, maxTemp: { min: 60, max: 250, warnMin: 100, warnMax: 160 }, // °C
    coolingWarn: 60,                               // minutes
    roastMinutes: { warnMin: 8, warnMax: 60 },     // beans loaded to beans finished (P2-B: a starting guess; a warning only)
    yieldLow: 65, yieldHigh: 90,                   // nib yield, % of beans in
    packageWarn: 60,                               // lbs in one package
    slack: 0.5,                                    // lbs of weighing difference before "more than there is"
    lastOfLeft: 1,                                 // "last of this ferment" is suggested within this many lbs
  };
  var PLACE = (typeof self !== 'undefined' && self.CH_CONFIG && self.CH_CONFIG.shipTo) || ''; // where shipments go (config.js), not hard-coded
  // config.js (loaded first on every page; read straight from the file in Node tests): units that are a choice
  var CONF = (typeof self !== 'undefined' && self.CH_CONFIG) || (typeof module !== 'undefined' && typeof require === 'function' ? require('./config.js') : {});

  function r1(n) { return Math.round(n * 10) / 10; }
  /**
   * A stored date (2026-11-18) as a person reads it on the phone: "Nov 18", with the year when it is not this year
   * ("Dec 31, 2025"). For showing only (app 1.19.3): what is saved and sent stays 2026-11-18. Anything else comes back as it is.
   */
  var DAY_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dayWords(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s == null ? '' : s));
    if (!m || +m[2] < 1 || +m[2] > 12) return s == null ? '' : String(s);
    return DAY_MONTHS[+m[2] - 1] + ' ' + (+m[3]) + (+m[1] === new Date().getFullYear() ? '' : ', ' + m[1]);
  }
  function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function minutesOf(t) { var m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
  /**
   * Roast numbers (P2-A). A roast is its own record, numbered in the season: R3.1, R3.2 … (shown as "Roast 3.1"). Roasts made
   * before P2-A are numbered under one ferment (3.4-R2) and keep that number for ever: printed labels last for years. Packages are
   * the roast's number, "-P" and a count: R3.1-P1, or 3.4-R2-P1 for an old roast. The ferment is never read from a new-shape number
   * (a roast can take beans from several ferments): it comes from the roast's lines (Roast inputs). Every ID is text: R3.1 is not
   * R3.10, and 3.1-R1 is not 3.10-R1. The same shapes as Code.gs CFG.ID_SHAPES (a test checks).
   */
  var ROAST_SHAPE = '(?:\\d+\\.\\d+-R\\d+|R\\d+\\.\\d+)';
  /** Next roast number of a season: "R", the season, ".", the highest number seen for that season + 1. '' without a season. */
  function nextSeasonRoastId(season, ids) {
    season = String(season == null ? '' : season).trim();
    if (!/^\d+$/.test(season)) return '';
    var re = new RegExp('^R' + season + '\\.(\\d+)$'), n = 0;
    (ids || []).forEach(function (id) { var m = re.exec(String(id)); if (m) n = Math.max(n, Number(m[1])); });
    return 'R' + season + '.' + (n + 1);
  }
  /** "Roast 3.1" for R3.1 (how people say it); an old number as it is ("Roast 3.4-R2"). */
  function roastName(id) { var m = /^R(\d+\.\d+)$/.exec(String(id || '')); return 'Roast ' + (m ? m[1] : String(id || '')); }
  /** The season a roast number belongs to: "3" for R3.1 and for 3.4-R2; '' for anything else. */
  function seasonOfRoast(id) { var m = /^R(\d+)\.\d+$/.exec(String(id || '')) || /^(\d+)\.\d+-R\d+$/.exec(String(id || '')); return m ? m[1] : ''; }
  /** The roast a package number belongs to, either shape: R3.1-P2 → R3.1, 3.4-R2-P1 → 3.4-R2; '' if it is neither. */
  function roastOfPackage(pid) { var m = new RegExp('^(' + ROAST_SHAPE + ')-P\\d+$').exec(String(pid || '')); return m ? m[1] : ''; }
  /** The ferment an OLD roast or package number names (3.4-R2, 3.4-R2-P1 → 3.4). A new-shape number names none: ''. */
  function fermentOfOldId(id) { var m = /^(\d+\.\d+)-R\d+(?:-P\d+)?$/.exec(String(id || '')); return m ? m[1] : ''; }
  /** Old roast numbers (before P2-A): the ferment, "-R", and the highest roast number seen for that ferment + 1. Kept for old drafts and tests. */
  function nextRoastId(ferment, ids) {
    var re = new RegExp('^' + esc(ferment) + '-R(\\d+)$'), n = 0;
    (ids || []).forEach(function (id) { var m = re.exec(String(id)); if (m) n = Math.max(n, Number(m[1])); });
    return ferment ? ferment + '-R' + (n + 1) : '';
  }
  /** Package IDs for a roast: "-P" and the next numbers (continues if the roast is packed in two sittings). */
  function packageIds(roast, count, ids) {
    var re = new RegExp('^' + esc(roast) + '-P(\\d+)$'), n = 0, out = [];
    (ids || []).forEach(function (id) { var m = re.exec(String(id)); if (m) n = Math.max(n, Number(m[1])); });
    for (var i = 1; i <= count; i++) out.push(roast + '-P' + (n + i));
    return out;
  }
  /** Shipment ID: "S", the 2-digit year of the ship date, "-", the next number that year (two digits). */
  function nextShipmentId(date, ids) {
    var yy = /^\d{4}/.test(String(date || '')) ? String(date).slice(2, 4) : String(new Date().getFullYear()).slice(2);
    var re = new RegExp('^S' + yy + '-(\\d+)$'), n = 0;
    (ids || []).forEach(function (id) { var m = re.exec(String(id)); if (m) n = Math.max(n, Number(m[1])); });
    return 'S' + yy + '-' + (n + 1 < 10 ? '0' : '') + (n + 1);
  }
  var ID_PATTERNS = { roast: '^' + ROAST_SHAPE + '$', package: '^' + ROAST_SHAPE + '-P\\d+$', shipment: '^S\\d{2}-\\d{2,}$' };

  /** Every ID of a kind this device has ever seen (also ones since removed), so it never suggests one twice. */
  function seenIds(ctx, kind) {
    if (ctx && typeof ctx.taken === 'function') return ctx.taken(kind);
    return ((ctx && ctx.known ? ctx.known(kind) : []) || []).map(function (x) { return x.id; });
  }
  /**
   * P2-C: the packages of a Pack entry as one flat list [{lbs, type, for}], in order. New entries have groups (Package type, Weight of
   * each, How many, For): each group gives "How many" rows. An entry from before (d.packages and one d.package_type) gives one row per
   * package, For Shipping. Everything that reads a Pack entry (numbering, filing, labels) reads it through here.
   */
  function packRows(d) {
    d = d || {};
    var out = [];
    if (Array.isArray(d.groups)) {
      d.groups.forEach(function (g) {
        g = g || {};
        var n = Math.floor(Number(g.count)); if (!(n >= 1)) n = 1; if (n > 1000) n = 1000; // a bad count is refused by check; never loop on a silly one
        for (var i = 0; i < n; i++) out.push({ lbs: g.lbs, type: g.package_type || '', 'for': g['for'] === 'Local use' ? 'Local use' : 'Shipping' });
      });
      return out;
    }
    return (d.packages || []).map(function (p) { return { lbs: (p || {}).lbs, type: d.package_type || '', 'for': 'Shipping' }; });
  }
  function packLbs(d) { return packRows(d).reduce(function (s, p) { return s + (num(p.lbs) || 0); }, 0); }
  /** '' if a Pack's package IDs fit its rows: one per package, each one of this roast's. */
  function packIdsProblem(d) {
    var ids = d.package_ids || [], n = packRows(d).length, pre = String(d.roast) + '-P';
    if (ids.length !== n) return 'There are ' + n + (n === 1 ? ' package' : ' packages') + ' but ' + ids.length + (ids.length === 1 ? ' package number' : ' package numbers') + '. Tap Save again.';
    var re = new RegExp(ID_PATTERNS.package);
    for (var i = 0; i < ids.length; i++) if (String(ids[i]).indexOf(pre) !== 0 || !re.test(String(ids[i]))) return 'Package ' + ids[i] + ' is not from roast ' + d.roast + '. Tap Save again.';
    if (ids.some(function (x, i) { return ids.indexOf(x) !== i; })) return 'Two packages have the same number. Tap Save again.';
    return '';
  }
  /** "ferments 3.4, 3.5" (or "ferment 3.4") for a roast of the lists: its Beans from lines, or an old roast's one ferment. '' if none known. */
  function roastFermentIds(r) {
    var fs = ((r && r.ferments) || []).map(function (f) { return f && typeof f === 'object' ? f.id : f; }).filter(Boolean).map(String);
    return fs.length ? fs : r && r.ferment ? [String(r.ferment)] : [];
  }
  function roastFermentsText(r) { var fs = roastFermentIds(r); return fs.length ? (fs.length > 1 ? 'ferments ' : 'ferment ') + fs.join(', ') : ''; }
  function findIn(list, id) { return (list || []).filter(function (x) { return String(x.id) === String(id); })[0]; }
  /** Dry lbs of a ferment not yet roasted (0 once it was marked "last of ferment"). */
  function fermentLeft(f) {
    if (!f || f.roast_closed) return 0;
    return r1(Math.max(0, (Number(f.dry_lbs) || 0) - (Number(f.roasted_lbs) || 0)));
  }
  /**
   * The lines of a roast ("Beans from"): [{ferment, lbs, last}]. An entry or draft made before P2-A has one ferment and no lines
   * (d.ferment, d.beans_in, d.last_of_ferment): it reads as one line, so everything that reads roasts works for both.
   */
  function roastLines(d) {
    d = d || {};
    if (Array.isArray(d.inputs)) return d.inputs.map(function (x) { x = x || {}; return { ferment: x.ferment === undefined || x.ferment === null ? '' : String(x.ferment), lbs: x.lbs, last: x.last }; });
    return d.ferment ? [{ ferment: String(d.ferment), lbs: d.beans_in, last: d.last_of_ferment }] : [];
  }
  /** Lbs into the roaster: the lines added up (one decimal). */
  function roastTotal(d) { return r1(roastLines(d).reduce(function (s, x) { return s + (num(x.lbs) || 0); }, 0)); }
  /**
   * The season a new roast is numbered in: the Current season (Lists), else the season of the first line's ferment, else (nothing
   * picked yet, so the number can show before Save) the newest season of the ferments this device knows.
   */
  function roastSeasonFor(d, ctx) {
    var cur = ctx && typeof ctx.list === 'function' ? String((ctx.list('Current season') || [])[0] || '').trim() : '';
    if (/^\d+$/.test(cur)) return cur;
    var first = roastLines(d)[0];
    if (first && /^\d+\.\d+$/.test(first.ferment)) return first.ferment.split('.')[0];
    var best = 0;
    ((ctx && typeof ctx.ferments === 'function' ? ctx.ferments() : []) || []).forEach(function (f) { var m = /^(\d+)\.\d+$/.exec(String(f && f.id)); if (m) best = Math.max(best, Number(m[1])); });
    return best ? String(best) : '';
  }
  /** '' if a new roast has a number of the right shape, else what to do. */
  function roastIdProblem(d) { return new RegExp(ID_PATTERNS.roast).test(String(d && d.roast_id || '')) ? '' : 'This roast has no roast number yet. Tap Save again.'; }
  function hasNibs(r) { return r && r.nib_lbs !== null && r.nib_lbs !== undefined && r.nib_lbs !== ''; }
  function nibsLeft(r) { return r1(Math.max(0, (Number(r && r.nib_lbs) || 0) - (Number(r && r.packed_lbs) || 0))); }
  function timeOrder(key, label, d, before, beforeLabel, out) {
    var a = minutesOf(before), b = minutesOf(d[key]);
    if (a === null || b === null || b >= a) return;
    if (a >= 20 * 60 && b <= 4 * 60) out.warnings.push({ key: key, msg: label + ' is earlier than the ' + beforeLabel + '. Is that after midnight?' });
    else out.errors.push({ key: key, msg: label + ' cannot be earlier than the ' + beforeLabel + ' (' + before + ').' });
  }

  var ROAST_CHECK = ['Good', 'Not good'];
  /** Is smell, taste or look 'Not good'? (shows the note question; also the summary) */
  function roastNotGood(d) { return ['smell', 'taste', 'look'].some(function (k) { return d && d[k] === 'Not good'; }); }
  /* ---------------- P2-E: a shipment is one pallet ---------------- */
  /** IDs in natural order: R3.2-P2 before R3.2-P10, R3.2 before R3.10. */
  function naturalCompare(a, b) {
    var x = String(a).match(/\d+|\D+/g) || [], y = String(b).match(/\d+|\D+/g) || [];
    for (var i = 0; i < Math.min(x.length, y.length); i++) {
      if (x[i] === y[i]) continue;
      if (/^\d/.test(x[i]) && /^\d/.test(y[i])) { var d = Number(x[i]) - Number(y[i]); if (d) return d; if (x[i].length !== y[i].length) return x[i].length - y[i].length; }
      return x[i] < y[i] ? -1 : 1;
    }
    return x.length - y.length;
  }
  /** Is this package kept for local use? A blank "For" (or anything else) counts as shipping. */
  function isLocalUse(p) { return /^local use$/i.test(String(p && p['for'] !== undefined && p['for'] !== null ? p['for'] : '').trim()); }
  /** Offered on a pallet: not on a pallet yet and not kept for local use. */
  function shippable(p) { return !p.shipment && !isLocalUse(p); }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /** "Nov 24" from 2026-11-24 (anything else as typed). */
  function niceDay(iso) {
    var m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m && MONTHS[Number(m[1]) - 1] ? MONTHS[Number(m[1]) - 1] + ' ' + Number(m[2]) : String(iso || '');
  }
  /** The ferments of a package, from its roast ("3.4, 3.5"); '' when this phone does not know the roast. */
  function packageFerments(p, ctx) {
    var r = findIn(ctx && ctx.known ? ctx.known('roast') : [], p.roast), ids = [];
    if (r) { (r.ferments || []).forEach(function (f) { var id = String(f && f.id !== undefined ? f.id : f); if (id && ids.indexOf(id) < 0) ids.push(id); }); if (!ids.length && r.ferment) ids.push(String(r.ferment)); }
    return ids.sort(naturalCompare).join(', ');
  }
  function packageLine(p, ctx) {
    var f = packageFerments(p, ctx);
    return p.id + ' · ' + p.lbs + ' lbs' + (p.contents === 'Shells' ? ' shells' : '') + (f ? ' · ferments ' + f : '');
  }
  /** The first entry of the "Packages per pallet" list as a number, or 0 (no counter). */
  function palletSize(ctx) {
    var v = ctx && typeof ctx.list === 'function' ? Number(String((ctx.list('Packages per pallet') || [])[0] || '').trim()) : 0;
    return v > 0 && isFinite(v) ? Math.floor(v) : 0;
  }
  /** Phase 2 review L1: has every package on this pallet been checked in (as far as this phone knows)? A pallet with none: no. */
  function palletArrived(s, ctx) {
    var mine = (ctx && ctx.known ? ctx.known('package') : []).filter(function (p) { return String(p.shipment) === String(s.id) && !isLocalUse(p); }); // slice B: same rule as the pallet list
    return mine.length > 0 && mine.every(function (p) { return !!p.arrived; });
  }
  function palletTotals(d, ctx) {
    var ids = d.packages || [], known = ctx && ctx.known ? ctx.known('package') : [];
    return { n: ids.length, lbs: r1(ids.reduce(function (s, id) { var p = findIn(known, id); return s + (p ? Number(p.lbs) || 0 : 0); }, 0)) };
  }
  /** "S26-03 · to port Nov 24 · 24 packages" (this phone's own count of what is on it). */
  function palletLine(s, ctx) {
    var n = (ctx && ctx.known ? ctx.known('package') : []).filter(function (p) { return String(p.shipment) === String(s.id) && !isLocalUse(p); }).length;
    return s.id + (s.date ? ' · to port ' + niceDay(s.date) : '') + (n ? ' · ' + n + (n === 1 ? ' package' : ' packages') : '');
  }

  FORMS.push(
    {
      id: 'roast', area: 'roasting', title: 'Roast', hint: 'Beans into the roaster', icon: 'flame',
      fields: [
        // P2-A: the roast has its own number in the season (R3.1). Shown before Save, given for good by prepare when it is saved.
        { key: 'roast_id', label: 'Roast', type: 'text', readonly: true, help: 'The next roast number this season. It is kept once you save.',
          default: function (d, ctx) { return nextSeasonRoastId(roastSeasonFor(d, ctx), seenIds(ctx, 'roast')); } },
        { key: 'inputs', label: 'Beans from', type: 'repeat', itemLabel: 'Ferment', min: 1, fields: [
          { key: 'ferment', label: 'Ferment', type: 'ferment', required: true,
            open: function (f) { return fermentLeft(f) > 0 && (!!f.bagged_date || f.dry_lbs !== null && f.dry_lbs !== undefined && f.dry_lbs !== ''); },
            itemText: function (f) { return f.id + ' · ' + fermentLeft(f) + ' lbs left'; } },
          { key: 'lbs', label: 'Dry beans from this ferment', type: 'number', unit: 'lbs', required: true, min: 0.1, max: LIMITS.beansIn.max, step: 0.1 },
          { key: 'last', label: 'Is this the last of this ferment\'s dry beans?', type: 'yesno' },
        ] },
        { key: 'date', label: 'Roast date', type: 'date', default: 'today', required: true },
        // P2-B (the slim roast form): what Jake asked for first; the old questions are still here, switched off in the menu
        { key: 'roaster', label: 'Roaster', type: 'choice', list: 'Roaster', hideIfEmpty: true, noneLabel: 'Not set' },
        { key: 'profile', label: 'Roast profile', type: 'choice', list: 'Roast plan', hideIfEmpty: true, noneLabel: 'Not set' },
        { key: 'bean_size', label: 'Bean size', type: 'choice', list: 'Bean size', hideIfEmpty: true, noneLabel: 'Not set' },
        { key: 'start_time', label: 'Beans loaded', type: 'time', now: true, required: true, default: 'now' },
        { key: 'finish_time', label: 'Beans finished', type: 'time', now: true },
        { key: 'max_temp', label: 'Max temperature', type: 'number', unit: '°C', min: LIMITS.maxTemp.min, max: LIMITS.maxTemp.max, warnMin: LIMITS.maxTemp.warnMin, warnMax: LIMITS.maxTemp.warnMax },
        { key: 'cooling_min', label: 'Cooling time', type: 'number', unit: 'minutes', min: 0, max: 240, warnMax: LIMITS.coolingWarn },
        { key: 'roasted_lbs', label: 'Weight after roasting', type: 'number', unit: 'lbs', min: 0.1, max: LIMITS.beansIn.max, step: 0.1, help: 'Optional.' },
        // the quick check of about 10 cut beans: three Good / Not good answers; a note only when something is not good
        { key: 'smell', label: 'Smell', type: 'choice', options: ROAST_CHECK },
        { key: 'taste', label: 'Taste', type: 'choice', options: ROAST_CHECK },
        { key: 'look', label: 'Look', type: 'choice', options: ROAST_CHECK },
        { key: 'quality_note', label: 'What is not good?', type: 'text', showIf: roastNotGood, paperNote: 'Only when smell, taste or look is not good', help: 'Optional.' },
        { key: 'profile_achieved', label: 'Roast profile achieved?', type: 'choice', options: ['Yes', 'Under-roasted', 'Over-roasted'] },
        { key: 'log_ref', fold: true, label: 'Roaster log ref / notes', type: 'text', help: 'Optional. For example the name or page of the roaster\'s own printed log.' },
        { key: 'notes', fold: true, label: 'Notes', type: 'textarea' },
        // off by default (they are still here: Jake switches them on under Questions)
        { key: 'max_temp_time', label: 'Reached max temperature', type: 'time', now: true },
        { key: 'start_temp_time', label: 'Reached starting temperature', type: 'time', now: true },
        { key: 'start_temp', label: 'Starting temperature', type: 'number', unit: '°C', min: LIMITS.startTemp.min, max: LIMITS.startTemp.max },
        { key: 'roaster_loads', label: 'Roaster loads', type: 'number', min: 1, max: 50, step: 1, inputmode: 'numeric', default: '1', help: 'How many loads went through the roaster for this record. One record is one roasting session; no need to enter each load.' },
        { key: 'bags_opened', fold: true, label: 'Bags opened', type: 'number', min: 0, max: 100, inputmode: 'numeric' },
      ],
      // "Into the roaster: 77 lbs from 2 ferments": the total is worked out from the lines, never typed
      live: { after: 'inputs', text: function (d) {
        var ls = roastLines(d), n = ls.filter(function (x) { return x.ferment; }).length, total = roastTotal(d);
        return total ? 'Into the roaster: ' + total + ' lbs' + (n ? ' from ' + n + (n === 1 ? ' ferment' : ' ferments') : '') : '';
      } },
      check: function (d, ctx) {
        var out = { errors: [], warnings: [] }, seen = Object.create(null), n = roastTotal(d);
        var lines = Array.isArray(d.inputs) ? d.inputs : null;
        roastLines(d).forEach(function (x, i) {
          // an old draft (one ferment, no lines) keeps its old keys, so its warnings still sit beside its own questions
          var k = lines ? 'inputs.' + i + '.' : '', lk = lines ? k + 'lbs' : 'beans_in', lastKey = lines ? k + 'last' : 'last_of_ferment';
          if (x.ferment && seen[x.ferment]) out.errors.push({ key: k + 'ferment', msg: 'Ferment ' + x.ferment + ' is listed twice. Add its weights together.' });
          if (x.ferment) seen[x.ferment] = true;
          var f = findIn(ctx.ferments(), x.ferment), lbs = num(x.lbs);
          if (!f || lbs === '') return;
          var left = fermentLeft(f);
          if (lbs > left + LIMITS.slack) out.warnings.push({ key: lk, msg: 'That is more than ferment ' + f.id + ' has left (' + left + ' lbs).' });
          else if (x.last !== 'Yes' && Math.abs(left - lbs) <= LIMITS.lastOfLeft) out.warnings.push({ key: lastKey, msg: 'That is almost all of ferment ' + f.id + '\'s dry beans (' + left + ' lbs). Mark this as the last of it?' });
        });
        timeOrder('finish_time', 'Beans finished', d, d.start_time, 'time the beans were loaded', out);
        var m0 = minutesOf(d.start_time), m1 = minutesOf(d.finish_time);
        if (m0 !== null && m1 !== null && m1 > m0 && (m1 - m0 < LIMITS.roastMinutes.warnMin || m1 - m0 > LIMITS.roastMinutes.warnMax)) out.warnings.push({ key: 'finish_time', msg: 'The roast took ' + (m1 - m0) + ' minutes. That looks unusual.' });
        timeOrder('start_temp_time', 'Reached starting temperature', d, d.start_time, 'start', out);
        timeOrder('max_temp_time', 'Reached max temperature', d, d.start_temp_time || d.start_time, d.start_temp_time ? 'time it reached starting temperature' : 'start', out);
        var rl = num(d.roasted_lbs);
        if (rl !== '' && n && (rl > n || rl < n * 0.8)) out.warnings.push({ key: 'roasted_lbs', msg: 'Weight after roasting (' + rl + ' lbs) looks unusual next to ' + n + ' lbs in.' });
        return out;
      },
      // prev: the answers already stored on this device under the same entry ID: their roast number is kept (it may be on a label).
      // Otherwise the number shown is kept unless another entry on this device (or the Sheet) has it by now; then the next free one.
      prepare: function (d, ctx, prev) {
        var re = new RegExp(ID_PATTERNS.roast);
        if (prev && re.test(String(prev.roast_id || ''))) return { roast_id: String(prev.roast_id) };
        var taken = seenIds(ctx, 'roast'), id = String(d.roast_id || '');
        if (!/^R\d+\.\d+$/.test(id) || taken.indexOf(id) >= 0) id = nextSeasonRoastId(roastSeasonFor(d, ctx), taken);
        return { roast_id: id };
      },
      preparedProblem: function (d) { return roastIdProblem(d); },
      makes: function (d) {
        var lines = roastLines(d).filter(function (x) { return x.ferment; }), one = lines.length === 1 ? String(lines[0].ferment) : '';
        return [{ kind: 'roast', id: d.roast_id, item: { ferment: one, ferments: lines.map(function (x) { return { id: String(x.ferment), lbs: num(x.lbs) }; }),
          date: d.date, beans_in: roastTotal(d), winnow_date: '', nib_lbs: null, packed_lbs: 0, closed: false } }];
      },
      summary: function (d) {
        if (!Array.isArray(d.inputs)) return 'Roast ' + d.roast_id + ' · ' + d.beans_in + ' lbs in'; // an entry saved before P2-A: as it was
        var n = roastLines(d).length;
        return roastName(d.roast_id) + ' · ' + roastTotal(d) + ' lbs in' + (n > 1 ? ' from ' + n + ' ferments' : '') + (roastNotGood(d) ? ' · check: not good' : '');
      },
      toOps: function (d) {
        var row = {
          'Roast ID': d.roast_id, 'Ferment ID': d.ferment, 'Roast date': d.date, 'Beans in lbs': num(d.beans_in), 'Roaster loads': num(d.roaster_loads), 'Bags opened': num(d.bags_opened),
          'Last of ferment': d.last_of_ferment === 'Yes' ? 'Yes' : '', 'Roaster': d.roaster || '', 'Roast plan': d.profile || '',
          'Start time': d.start_time || '', 'Start temp reached time': d.start_temp_time || '', 'Max temp reached time': d.max_temp_time || '',
          'Start temp °C': num(d.start_temp), 'Max temp °C': num(d.max_temp), 'Cooling minutes': num(d.cooling_min), 'Roasted lbs': num(d.roasted_lbs), 'Roaster log ref': d.log_ref || '', 'Notes': d.notes || '',
        };
        // P2-B: an old draft or stored entry has none of these answers, so it files exactly the row it always did
        var q = { 'Bean size': d.bean_size, 'Finish time': d.finish_time, 'Smell': d.smell, 'Taste': d.taste, 'Look': d.look, 'Quality note': roastNotGood(d) ? d.quality_note : '', 'Profile achieved': d.profile_achieved };
        for (var qk in q) if (q[qk]) row[qk] = String(q[qk]).trim();
        if (!Array.isArray(d.inputs)) return [{ op: 'append', tab: 'Roasts', row: row }]; // an old draft or stored entry (one ferment): exactly the row it always gave
        var bad = roastIdProblem(d);
        if (bad) throw new Error(bad); // never file a roast under no number or a wrong one
        // P2-A: the roast row names no ferment (its lines do) and carries the total; each line is a Roast inputs row
        delete row['Ferment ID']; delete row['Last of ferment'];
        row['Beans in lbs'] = roastTotal(d);
        return [{ op: 'append', tab: 'Roasts', row: row }].concat(d.inputs.map(function (x) {
          return { op: 'append', tab: 'Roast inputs', row: { 'Roast ID': d.roast_id, 'Ferment ID': x.ferment, 'Lbs': num(x.lbs), 'Last of ferment': x.last === 'Yes' ? 'Yes' : '' } };
        }));
      },
    },
    {
      id: 'winnow', area: 'roasting', title: 'Winnow', hint: 'Weigh nibs and shells', icon: 'wind',
      fields: [
        { key: 'roast', label: 'Roast', type: 'ref', of: 'roast', required: true, pattern: ID_PATTERNS.roast, patternHelp: 'A roast ID looks like R3.1 (or 3.4-R2 from before)',
          open: function (r) { return !hasNibs(r); }, itemText: function (r) { var t = roastFermentsText(r); return r.id + ' · ' + r.beans_in + ' lbs in' + (t ? ' · ' + t : ''); } },
        { key: 'date', label: 'Winnow date', type: 'date', default: 'today', required: true },
        { key: 'nib_lbs', label: 'Nibs after winnowing', type: 'number', unit: 'lbs', required: true, min: 0.1, max: 500, step: 0.1 },
        { key: 'shell_lbs', label: 'Shells removed', type: 'number', unit: 'lbs', min: 0, max: 200, step: 0.1 },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ],
      // "Beans from 3.4 (40 lbs) and 3.5 (37 lbs)": what went into the roast being winnowed
      live: { after: 'roast', text: function (d, ctx) {
        var r = ctx && typeof ctx.known === 'function' ? findIn(ctx.known('roast'), d.roast) : null;
        if (!r) return '';
        var fs = ((r.ferments || []).filter(function (f) { return f && (typeof f !== 'object' || f.id); })).map(function (f) { return typeof f === 'object' ? { id: String(f.id), lbs: num(f.lbs) } : { id: String(f), lbs: '' }; });
        if (!fs.length && r.ferment) fs = [{ id: String(r.ferment), lbs: fs.length ? '' : (num(r.beans_in)) }];
        if (!fs.length) return '';
        var bits = fs.map(function (f) { return f.id + (f.lbs !== '' && f.lbs !== null && f.lbs !== undefined ? ' (' + f.lbs + ' lbs)' : ''); });
        return 'Beans from ' + (bits.length > 1 ? bits.slice(0, -1).join(', ') + ' and ' + bits[bits.length - 1] : bits[0]);
      } },
      check: function (d, ctx) {
        var out = { errors: [], warnings: [] }, r = findIn(ctx.known('roast'), d.roast), nib = num(d.nib_lbs), shell = num(d.shell_lbs);
        if (r && nib !== '' && r.beans_in) {
          var pct = nib / r.beans_in * 100;
          if (nib > r.beans_in) out.warnings.push({ key: 'nib_lbs', msg: 'Nibs (' + nib + ' lbs) are more than the beans that went in (' + r.beans_in + ' lbs).' });
          else if (pct < LIMITS.yieldLow || pct > LIMITS.yieldHigh) out.warnings.push({ key: 'nib_lbs', msg: 'Nibs are ' + Math.round(pct) + '% of the beans in. That looks unusual (usually ' + LIMITS.yieldLow + '–' + LIMITS.yieldHigh + '%).' });
          if (shell !== '' && nib + shell > r.beans_in + LIMITS.slack) out.warnings.push({ key: 'shell_lbs', msg: 'Nibs and shells together (' + r1(nib + shell) + ' lbs) are more than the beans in (' + r.beans_in + ' lbs).' });
        }
        return out;
      },
      confirm: function (d) { return 'This records roast ' + d.roast + ' as winnowed: ' + d.nib_lbs + ' lbs of nibs. Is that right?'; },
      marks: function (d) { return [{ kind: 'roast', id: d.roast, set: { winnow_date: d.date, nib_lbs: num(d.nib_lbs) } }]; },
      summary: function (d) { return 'Roast ' + d.roast + ' · ' + d.nib_lbs + ' lbs of nibs'; },
      toOps: function (d) {
        return [{ op: 'update', tab: 'Roasts', key: d.roast, set: { 'Winnow date': d.date, 'Nib lbs': num(d.nib_lbs), 'Shell lbs': num(d.shell_lbs), 'Winnow notes': d.notes || '' } }];
      },
    },
    {
      id: 'pack', area: 'roasting', title: 'Pack', hint: 'Weigh packages, print labels', icon: 'scale', afterSave: 'labels',
      fields: [
        { key: 'roast', label: 'Roast', type: 'ref', of: 'roast', required: true, pattern: ID_PATTERNS.roast, patternHelp: 'A roast ID looks like R3.1 (or 3.4-R2 from before)',
          // shells can be packed from a roast whose nibs are all packed (closed); nibs only from one still open
          open: function (r, ctx, d) { return hasNibs(r) && (!r.closed || !!(d && d.contents === 'Shells')); },
          itemText: function (r) { var t = roastFermentsText(r); return r.id + ' · ' + r.nib_lbs + ' lbs of nibs' + (r.packed_lbs ? ', ' + r1(r.packed_lbs) + ' packed' : '') + (t ? ' · ' + t : ''); } },
        { key: 'date', label: 'Pack date', type: 'date', default: 'today', required: true },
        { key: 'contents', label: 'What is in the packages?', type: 'choice', options: ['Nibs', 'Shells'], default: 'Nibs', required: true },
        // P2-C: one save can pack several kinds: "3 vacuum bags of 30 lb for shipping and 12 one-pound bags for local use"
        { key: 'groups', label: 'Packages', type: 'repeat', itemLabel: 'Package', addText: 'Add another kind of package', min: 1, fields: [
          { key: 'package_type', label: 'Package type', type: 'choice', list: 'Package type', hideIfEmpty: true, noneLabel: 'Not set', default: function (d, ctx) { return ctx && ctx.list ? (ctx.list('Package type')[0] || '') : ''; } },
          { key: 'lbs', label: 'Weight of each', type: 'number', unit: 'lbs', required: true, min: 0.1, max: 200, warnMax: LIMITS.packageWarn, step: 0.1,
            default: function (d, ctx) { return (ctx && ctx.list ? (ctx.list('Standard package lbs')[0] || '') : '') || '30'; }, help: 'Starts at the standard package weight (set on the Lists page). Change it for an odd one.' },
          { key: 'count', label: 'How many', type: 'number', required: true, min: 1, max: 100, step: 1, inputmode: 'numeric', default: '1' },
          { key: 'for', label: 'For', type: 'choice', options: ['Shipping', 'Local use'], default: 'Shipping', required: true },
        ] },
        { key: 'last_of_roast', label: 'Is everything from this roast now packed?', type: 'yesno', dependsOn: 'contents', default: function (d) { return d.contents === 'Shells' ? 'No' : 'Yes'; }, showIf: function (d) { return d.contents !== 'Shells'; }, paperNote: 'Only for nibs' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ],
      // "15 packages · 102 lbs · 90 for shipping, 12 for local use"
      live: { after: 'groups', text: function (d) {
        var rows = packRows(d).filter(function (p) { return num(p.lbs) !== ''; });
        if (!rows.length) return '';
        var ship = 0, local = 0;
        rows.forEach(function (p) { if (p['for'] === 'Local use') local += num(p.lbs); else ship += num(p.lbs); });
        var t = rows.length + (rows.length === 1 ? ' package' : ' packages') + ' · ' + r1(ship + local) + ' lbs';
        if (local) t += ' · ' + (ship ? r1(ship) + ' for shipping, ' : '') + r1(local) + ' for local use';
        return t;
      } },
      check: function (d, ctx) {
        var out = { errors: [], warnings: [] }, r = findIn(ctx.known('roast'), d.roast), rows = packRows(d), gk = Array.isArray(d.groups) ? 'groups' : 'packages'; // an entry from before keeps its old key
        if (d.package_ids && packIdsProblem(d)) out.errors.push({ key: gk, msg: packIdsProblem(d) });
        (d.groups || []).forEach(function (g, i) {
          var c = g && g.count;
          if (c !== undefined && c !== null && c !== '' && !isNaN(Number(c)) && Math.floor(Number(c)) !== Number(c)) out.errors.push({ key: 'groups.' + i + '.count', msg: 'How many must be a whole number.' });
        });
        if (rows.length > 100) out.errors.push({ key: gk, msg: 'That is more than 100 packages. Save this in two goes.' });
        if (r && d.contents !== 'Shells') {
          var total = r1(packLbs(d)), left = nibsLeft(r); // packages for local use count too: they are packed from the same nibs
          if (total > left + LIMITS.slack) out.warnings.push({ key: gk, msg: 'These packages add up to ' + total + ' lbs. Roast ' + r.id + ' has only ' + left + ' lbs of nibs left to pack.' });
        }
        return out;
      },
      // prev: the answers already stored on this device under the same entry ID (labels may be printed): their IDs are kept,
      // and only extra rows get new ones. Without prev every ID is worked out again.
      prepare: function (d, ctx, prev) {
        var n = packRows(d).length;
        var mine = prev && prev.roast === d.roast ? (prev.package_ids || []).filter(function (id) { return String(id).indexOf(d.roast + '-P') === 0; }) : [];
        var keep = mine.slice(0, n);
        return { package_ids: keep.concat(packageIds(d.roast, n - keep.length, seenIds(ctx, 'package').concat(mine))) };
      },
      preparedProblem: packIdsProblem,
      makes: function (d) {
        var rows = packRows(d);
        return (d.package_ids || []).map(function (id, i) {
          var p = rows[i] || {};
          return { kind: 'package', id: id, item: { roast: d.roast, contents: d.contents || 'Nibs', lbs: num(p.lbs), 'for': p['for'] || 'Shipping', pack_date: d.date, shipment: '', arrived: false, arrival_lbs: null, used_lbs: 0, emptied: false } };
        });
      },
      marks: function (d) {
        if (d.contents === 'Shells') return [];
        return [{ kind: 'roast', id: d.roast, add: { packed_lbs: packLbs(d) }, set: d.last_of_roast === 'Yes' ? { closed: true } : {} }];
      },
      summary: function (d) {
        var n = packRows(d).length;
        return 'Roast ' + d.roast + ' · ' + n + (n === 1 ? ' package · ' : ' packages · ') + r1(packLbs(d)) + ' lbs';
      },
      toOps: function (d) {
        var bad = packIdsProblem(d);
        if (bad) throw new Error(bad); // never file packages under the wrong IDs or lose one
        var rows = packRows(d), isNew = Array.isArray(d.groups);
        return (d.package_ids || []).map(function (id, i) {
          var last = i === d.package_ids.length - 1 && d.contents !== 'Shells' && d.last_of_roast === 'Yes';
          var row = { 'Package ID': id, 'Roast ID': d.roast, 'Pack date': d.date, 'Contents': d.contents || 'Nibs', 'Package type': rows[i].type || '', 'Lbs': num(rows[i].lbs) };
          if (isNew) row['For'] = rows[i]['for']; // an entry from before has no For column: exactly the row it always gave
          row['Last of roast'] = last ? 'Yes' : ''; row['Notes'] = i === 0 ? d.notes || '' : '';
          return { op: 'append', tab: 'Packages', row: row };
        });
      },
    },
    {
      id: 'ship', area: 'roasting', title: 'Ship', hint: 'Packages leaving' + (PLACE ? ' for ' + PLACE : ''), icon: 'send',
      fields: [
        { key: 'date', label: 'Date taken to the port', type: 'date', default: 'today', required: true },
        // P2-E: every packed package meant for shipping that is not on a pallet yet starts ticked (worked out once, when the draft is made); untick what did not fit
        { key: 'packages', label: 'Packages on this pallet', type: 'ref', of: 'package', multiple: true, required: true, tickButtons: true, pattern: ID_PATTERNS.package, patternHelp: 'A package ID looks like R3.1-P1 (or 3.4-R2-P1 from before)',
          open: function (p) { return shippable(p); },
          default: function (d, ctx) { return ctx && ctx.known ? ctx.known('package').filter(function (p) { return shippable(p) && !p.held; }).map(function (p) { return String(p.id); }).sort(naturalCompare) : []; }, // Phase 2 review M2: never a package from a Pack held for review (it can still be ticked by hand)
          itemText: function (p, ctx) { return packageLine(p, ctx); } },
        { key: 'destination', label: 'Going to (port)', type: 'choice', list: 'Port', noneLabel: 'Not set', default: function (d, ctx) { return ctx && ctx.list ? (ctx.list('Port')[0] || '') : ''; } },
        { key: 'carrier', label: 'Sent with', type: 'choice', list: 'Carrier', hideIfEmpty: true, noneLabel: 'Not set' },
        { key: 'tracking', label: 'Tracking or reference', type: 'text' },
        { key: 'notes', fold: true, label: 'Notes', type: 'textarea' },
      ],
      live: { after: 'packages', text: function (d, ctx) {
        var t = palletTotals(d, ctx);
        if (!t.n) return '';
        var cap = palletSize(ctx);
        return t.n + (cap ? ' of ' + cap : '') + (t.n === 1 ? ' package' : ' packages') + (t.lbs ? ' · ' + t.lbs + ' lbs' : '');
      } },
      check: function (d, ctx) {
        var out = { errors: [], warnings: [] }, known = ctx && ctx.known ? ctx.known('package') : [];
        (d.packages || []).forEach(function (id) {
          var p = findIn(known, id);
          if (p && isLocalUse(p)) out.errors.push({ key: 'packages', msg: 'Package ' + id + ' is kept for local use.' });
        });
        var cap = palletSize(ctx), n = (d.packages || []).length;
        if (cap && n > cap) out.warnings.push({ key: 'packages', msg: 'That is more than a pallet usually holds (' + cap + ').' });
        return out;
      },
      confirm: function (d, ctx) {
        var t = palletTotals(d, ctx);
        return 'This records pallet ' + (d.shipment_id || nextShipmentId(d.date, seenIds(ctx, 'shipment'))) + ': ' + t.n + (t.n === 1 ? ' package' : ' packages') + (t.lbs ? ' (' + t.lbs + ' lbs)' : '') + ', taken to ' + (d.destination || 'the port') + ' on ' + niceDay(d.date) + '. Is that right?';
      },
      prepare: function (d, ctx, prev) { return { shipment_id: prev && prev.shipment_id ? prev.shipment_id : nextShipmentId(d.date, seenIds(ctx, 'shipment')) }; }, // a stored one is kept
      preparedProblem: function (d) { return new RegExp(ID_PATTERNS.shipment).test(String(d.shipment_id || '')) ? '' : 'This shipment has no shipment ID yet. Tap Save again.'; },
      makes: function (d) { return d.shipment_id ? [{ kind: 'shipment', id: d.shipment_id, item: { date: d.date, destination: d.destination || '', left_port: '', tracking: d.tracking || '' } }] : []; },
      marks: function (d) { return (d.packages || []).map(function (id) { return { kind: 'package', id: id, set: { shipment: d.shipment_id } }; }); },
      summary: function (d) { var n = (d.packages || []).length; return (d.shipment_id ? d.shipment_id + ' · ' : '') + n + (n === 1 ? ' package' : ' packages'); },
      toOps: function (d) {
        if (!new RegExp(ID_PATTERNS.shipment).test(String(d.shipment_id || ''))) throw new Error('This shipment has no shipment ID yet. Tap Save again.');
        return [{ op: 'append', tab: 'Shipments', row: { 'Shipment ID': d.shipment_id, 'Ship date': d.date, 'Carrier': d.carrier || '', 'Tracking': d.tracking || '', 'Notes': d.notes || '', 'Destination': d.destination || '' } }]
          .concat((d.packages || []).map(function (id) { return { op: 'update', tab: 'Packages', key: id, set: { 'Shipment ID': d.shipment_id } }; }));
      },
    },
    {
      // P2-E: weeks later, the day the pallet left the port. Fills Left port date once (and Tracking, only when it had none); never touches Packages.
      id: 'ship_left', area: 'roasting', title: 'Pallet left the port', progressLabel: 'Left the port', hint: 'The day it left the port', icon: 'anchor',
      fields: [
        { key: 'shipment', label: 'Pallet', type: 'ref', of: 'shipment', required: true, pattern: ID_PATTERNS.shipment, patternHelp: 'A pallet number looks like S26-01',
          open: function (s, ctx) { return !s.left_port && !palletArrived(s, ctx); }, // Phase 2 review L1: every package checked in: it has left
          itemText: function (s, ctx) { return palletLine(s, ctx); } },
        { key: 'date', label: 'Date it left the port', type: 'date', default: 'today', required: true },
        { key: 'tracking', label: 'Tracking or reference', type: 'text', help: 'Only if you did not have it before.' },
      ],
      check: function (d, ctx) {
        var out = { errors: [], warnings: [] }, s = findIn(ctx && ctx.known ? ctx.known('shipment') : [], d.shipment);
        if (s && s.date && d.date && String(d.date) < String(s.date)) out.errors.push({ key: 'date', msg: 'It cannot leave the port before it was taken there (' + niceDay(s.date) + ').' });
        if (s && s.left_port) out.errors.push({ key: 'shipment', msg: 'Pallet ' + s.id + ' is already marked as having left the port.' });
        return out;
      },
      confirm: function (d) { return 'This records pallet ' + d.shipment + ' as leaving the port on ' + niceDay(d.date) + '. Is that right?'; },
      marks: function (d) { return d.shipment ? [{ kind: 'shipment', id: d.shipment, set: { left_port: d.date } }] : []; },
      summary: function (d) { return d.shipment + ' · left ' + niceDay(d.date); },
      toOps: function (d) {
        var set = { 'Left port date': d.date };
        if (String(d.tracking || '').trim()) set['Tracking'] = String(d.tracking).trim();
        return [{ op: 'update', tab: 'Shipments', key: d.shipment, set: set }];
      },
    }
  );

  /* ---------------- Local use (P2-F): the one form on the menu by itself that starts off ----------------
   * Packages kept for local use (marked "Local use" at Pack) never go on a pallet. This form takes some or all of one: which package,
   * what for (the "Used for" list), how many lbs. Built now, off until a company switches it on under Questions. The script still
   * takes it from a phone that shows it (a switch only decides whether the form is shown). No money here (local sales are P3-B).
   */
  var LOCAL_WORD = 'Local use'; // a package's "for" (model.js packages(), Code.gs CFG.LOCAL_USE_WORD)
  function isLocalPkg(p) { return !!p && String(p['for'] || '').trim().toLowerCase() === 'local use'; }
  /** What is left in a package kept for local use: what was packed minus the local uses (never below 0; 0 once emptied). */
  function localLeft(p) {
    if (!p || p.local_emptied) return 0;
    return r1(Math.max(0, (Number(p.lbs) || 0) - (Number(p.local_used_lbs) || 0)));
  }
  function lbsWords(n) { return n + (n === 1 ? ' lb' : ' lbs'); }
  FORMS.push({
    id: 'local_use', area: 'roasting', title: 'Local use', hint: 'Packages used here, not shipped', icon: 'package-check',
    switchHint: 'Record packages used locally instead of shipped.', // what the Settings page says under this form's own switch
    fields: [
      { key: 'package', label: 'Package', type: 'ref', of: 'package', required: true, pattern: ID_PATTERNS.package, patternHelp: 'A package ID looks like R3.1-P1 (or 3.4-R2-P1 from before)',
        open: function (p) { return isLocalPkg(p) && !p.shipment && !p.local_emptied; },
        itemText: function (p) { return p.id + ' · ' + lbsWords(localLeft(p)) + ' left' + (p.contents ? ' · ' + p.contents : ''); } },
      { key: 'date', label: 'Date', type: 'date', default: 'today', required: true },
      { key: 'used_for', label: 'What was it used for?', type: 'choice', list: 'Used for', required: true },
      { key: 'lbs', label: 'Weight used', type: 'number', unit: 'lbs', required: true, min: 0.1, max: 200, step: 0.1, dependsOn: 'package', // 200 lbs, as Check in and Start batch
        default: function (d, ctx) { var p = ctx && d.package ? findIn(ctx.known('package'), d.package) : null; return p ? String(localLeft(p)) : ''; },
        help: 'Starts at what is left in the package. Change it if only part is used.' },
      { key: 'emptied', label: 'Does this empty the package?', type: 'yesno', dependsOn: 'package',
        default: function (d, ctx) { var p = ctx && d.package ? findIn(ctx.known('package'), d.package) : null; return p && num(d.lbs) !== '' && Number(d.lbs) >= localLeft(p) - 0.05 ? 'Yes' : 'No'; } },
      { key: 'notes', fold: true, label: 'Notes', type: 'textarea' },
    ],
    check: function (d, ctx) {
      var out = { errors: [], warnings: [] }, p = findIn(ctx.known('package'), d.package), n = num(d.lbs);
      if (!p) return out;
      var left = localLeft(p);
      if (n !== '' && n > left + MLIMITS.usedSlack) out.warnings.push({ key: 'lbs', msg: 'That is more than the ' + left + ' lbs left in package ' + p.id + '.' });
      if (d.emptied === 'Yes' && n !== '' && left - n > MLIMITS.arrivalDiffLbs) out.warnings.push({ key: 'emptied', msg: 'Package ' + p.id + ' would still have ' + r1(left - n) + ' lbs left. Is it really empty?' });
      if (d.emptied !== 'Yes' && n !== '' && n >= left - 0.05 && left > 0) out.warnings.push({ key: 'emptied', msg: 'This is all that is left in package ' + p.id + '. Does it empty the package?' });
      return out;
    },
    marks: function (d) { return [{ kind: 'package', id: d.package, add: { local_used_lbs: num(d.lbs) || 0 }, set: d.emptied === 'Yes' ? { local_emptied: true } : {} }]; },
    summary: function (d) { return 'Package ' + d.package + ' · ' + d.lbs + ' lbs' + (d.used_for ? ' · ' + d.used_for : ''); },
    toOps: function (d) { // one append; the script hands out the Local use ID (LU001)
      return [{ op: 'append', tab: 'Local use', row: { 'Package ID': d.package, 'Use date': d.date, 'Used for': d.used_for || '', 'Lbs used': num(d.lbs), 'Emptied': d.emptied === 'Yes' ? 'Yes' : '', 'Notes': d.notes || '' } }];
    },
  });

  /* ---------------- Making (stage 3): Check in, Start batch, Finish batch ----------------
   * ASSUMPTIONS (not confirmed yet; each is a one-line change, see README "Making (Walpole)"):
   *   lbs, and temperatures in TEMP: CH_CONFIG.units.makingTemp in config.js (°F: Walpole is in the US). The unit is in the
   *   column names ("Conche temp °F"), so it is set once there (and once in Code.gs, CFG.MAKING_TEMP_UNIT; a test checks they agree)
   *   batch IDs are W26-001 (MAKING.prefix, 2-digit year, 3-digit number) and can be typed over
   *   smell, taste and look are the words on the Lists page's "Arrival check" list (OK / Not OK)
   *   a batch can use several packages and part of a package (lbs used per package)
   *   every "looks unusual" limit below is a starting guess (MLIMITS)
   */
  var TEMP = (CONF.units || {}).makingTemp; // e.g. '°F'
  var MAKING = {
    prefix: 'W',                 // batch IDs start with this letter
    tempUnit: TEMP,              // from config.js (see above)
    chocolate: 'Chocolate',      // the "Batch destination" word that means chocolate: the sugar, fineness and conching questions show only for it
  };
  var MLIMITS = {
    arrivalLbs: { min: 0.1, max: 200 },
    arrivalDiffLbs: 0.5, arrivalDiffPct: 2,   // a weight change bigger than both of these is flagged on arrival
    sugar: { min: 0, max: 500 }, butter: { min: 0, max: 200 }, otherLbs: { min: 0, max: 200 },
    micron: { min: 5, max: 100, warnMin: 12, warnMax: 35 },
    hoursToTarget: { min: 0, max: 200 },
    concheHours: { min: 0, max: 200, warnMax: 120 },    // a starting guess
    concheTemp: { min: 68, max: 212, warnMin: 104, warnMax: 176 },  // in TEMP (°F): change these with the unit
    processTemp: { min: 32, max: 500 },                 // in TEMP (°F), grinder or press
    output: { min: 0, max: 1000 },
    usedSlack: 0.2,                                     // lbs more than is left in a package before a warning
  };
  // 2.4.2: never a word every JavaScript object already has (it would break the pages that look batches up by number); the script refuses the same words (Code.gs PROTO_WORDS_)
  var BATCH_PATTERN = '^(?!(?:constructor|toString|toLocaleString|valueOf|hasOwnProperty|isPrototypeOf|propertyIsEnumerable)$)[A-Za-z0-9][A-Za-z0-9.\\-]{1,19}$';
  function isChoc(dest) { return String(dest || '').trim().toLowerCase() === MAKING.chocolate.toLowerCase(); }
  /** Batch ID: the prefix, the 2-digit year of the start date, "-", the next number that year (3 digits). Hand-typed IDs that do not fit are ignored. */
  function nextBatchId(date, ids) {
    var yy = /^\d{4}/.test(String(date || '')) ? String(date).slice(2, 4) : String(new Date().getFullYear()).slice(2);
    var re = new RegExp('^' + esc(MAKING.prefix) + yy + '-(\\d+)$'), n = 0;
    (ids || []).forEach(function (id) { var m = re.exec(String(id)); if (m) n = Math.max(n, Number(m[1])); });
    return MAKING.prefix + yy + '-' + ('00' + (n + 1)).slice(-Math.max(3, String(n + 1).length));
  }
  /** What is left in a package: what arrived (else what was packed) minus what batches used; never below 0. */
  function pkgLeft(p) {
    if (!p) return 0;
    var had = p.arrival_lbs !== null && p.arrival_lbs !== undefined && p.arrival_lbs !== '' ? Number(p.arrival_lbs) : Number(p.lbs) || 0;
    return r1(Math.max(0, had - (Number(p.used_lbs) || 0)));
  }
  function inputsLbs(d) { return r1((d.inputs || []).reduce(function (s, x) { return s + (num(x.lbs) || 0); }, 0)); }
  function isShells(c) { return /^shells?$/i.test(String(c || '').trim()); } // as the server and model.js read "Contents"
  /** Lbs of nibs a Start batch uses: its packages, leaving out shells packages (as far as this device knows the packages). */
  function nibInputsLbs(d, ctx) {
    var known = ctx && ctx.known ? ctx.known('package') : [];
    return r1((d.inputs || []).reduce(function (s, x) { var p = findIn(known, x.package); return s + (p && isShells(p.contents) ? 0 : num(x.lbs) || 0); }, 0));
  }
  /** A batch ID made by nextBatchId for some year ("W26-004"), not one typed in another shape. */
  function autoBatchId(id) { return new RegExp('^' + esc(MAKING.prefix) + '\\d{2}-\\d{3,}$').test(String(id || '')); }
  /** "70 : 30" from nib and sugar weights; '' until both are known. */
  function nibSugar(nib, sugar) {
    var n = num(nib), g = num(sugar);
    if (n === '' || g === '' || n + g <= 0) return '';
    var a = Math.round(n / (n + g) * 100);
    return a + ' : ' + (100 - a);
  }
  function chocAnswers(d) { return isChoc(d.destination); }
  function destOf(d, ctx) { var b = findIn(ctx ? ctx.known('batch') : [], d.batch); return b ? b.destination || '' : ''; }

  FORMS.push(
    {
      id: 'arrival', area: 'making', title: 'Check in', hint: 'A package has arrived', icon: 'package-check',
      fields: [
        { key: 'package', label: 'Package', type: 'ref', of: 'package', required: true, pattern: ID_PATTERNS.package, patternHelp: 'A package ID looks like R3.1-P1 (or 3.4-R2-P1 from before)',
          open: function (p) { return !p.arrived && !(isLocalUse(p) && !p.shipment); }, // Phase 2 review M3: a package kept for local use (and on no pallet) stays at the factory
          itemText: function (p) { return p.id + ' · ' + p.lbs + ' lbs' + (p.contents === 'Shells' ? ' shells' : '') + (p.shipment ? ' · shipped' : ''); } },
        { key: 'date', label: 'Arrival date', type: 'date', default: 'today', required: true },
        { key: 'arrival_lbs', label: 'Weight on arrival', type: 'number', unit: 'lbs', required: true, min: MLIMITS.arrivalLbs.min, max: MLIMITS.arrivalLbs.max, step: 0.1 },
        { key: 'smell', label: 'Smell', type: 'choice', list: 'Arrival check', hideIfEmpty: true, noneLabel: 'Not checked' },
        { key: 'taste', label: 'Taste', type: 'choice', list: 'Arrival check', hideIfEmpty: true, noneLabel: 'Not checked' },
        { key: 'look', label: 'Look', type: 'choice', list: 'Arrival check', hideIfEmpty: true, noneLabel: 'Not checked' },
        { key: 'notes', label: 'Notes', type: 'textarea', help: 'If anything is not OK, say what you noticed.' },
      ],
      check: function (d, ctx) {
        var out = { errors: [], warnings: [] }, p = findIn(ctx.known('package'), d.package), n = num(d.arrival_lbs);
        if (p && n !== '' && p.lbs) {
          var diff = r1(n - p.lbs), limit = Math.max(MLIMITS.arrivalDiffLbs, p.lbs * MLIMITS.arrivalDiffPct / 100);
          if (Math.abs(diff) > limit) out.warnings.push({ key: 'arrival_lbs', msg: 'It was packed at ' + p.lbs + ' lbs, so this is ' + Math.abs(diff) + ' lbs ' + (diff < 0 ? 'less' : 'more') + '. Check the weight.' });
        }
        return out;
      },
      marks: function (d) { return [{ kind: 'package', id: d.package, set: { arrived: true, arrival_lbs: num(d.arrival_lbs) } }]; },
      summary: function (d) { return 'Package ' + d.package + ' · ' + d.arrival_lbs + ' lbs arrived'; },
      toOps: function (d) {
        return [{ op: 'append', tab: 'Arrivals', row: { 'Package ID': d.package, 'Arrival date': d.date, 'Arrival lbs': num(d.arrival_lbs), 'Smell': d.smell || '', 'Taste': d.taste || '', 'Look': d.look || '', 'Notes': d.notes || '' } }];
      },
    },
    {
      id: 'batch_start', area: 'making', title: 'Start batch', hint: 'Nibs into the grinder', icon: 'blend',
      fields: [
        { key: 'batch_id', label: 'Batch', type: 'text', required: true, pattern: BATCH_PATTERN, patternHelp: 'Letters, numbers, dots and dashes (2 to 20), like ' + MAKING.prefix + '26-001',
          // follows the start date's year: a date in another year gives that year's next number, unless the number was typed in another shape
          help: 'Worked out for you. Type over it to use a number you already have.', dependsOn: 'date', default: function (d, ctx) {
            var date = d.date || (ctx && ctx.today ? ctx.today() : '');
            var yy = /^\d{4}/.test(String(date)) ? String(date).slice(2, 4) : '';
            if (d.batch_id && (!autoBatchId(d.batch_id) || String(d.batch_id).slice(MAKING.prefix.length, MAKING.prefix.length + 2) === yy)) return d.batch_id; // typed, or already this year's
            return nextBatchId(date, seenIds(ctx, 'batch'));
          } },
        { key: 'date', label: 'Start date', type: 'date', default: 'today', required: true },
        { key: 'destination', label: 'What is this batch for?', type: 'choice', list: 'Batch destination', required: true, default: function (d, ctx) { return ctx && ctx.list ? (ctx.list('Batch destination')[0] || '') : ''; } },
        { key: 'recipe', label: 'Recipe or product name', type: 'text' },
        { key: 'inputs', label: 'Packages used', type: 'repeat', itemLabel: 'Package', min: 1, fields: [
          { key: 'package', label: 'Package', type: 'ref', of: 'package', required: true, pattern: ID_PATTERNS.package, patternHelp: 'A package ID looks like R3.1-P1 (or 3.4-R2-P1 from before)',
            open: function (p) { return !!p.arrived && !p.emptied && pkgLeft(p) > 0; },
            itemText: function (p) { return p.id + ' · ' + pkgLeft(p) + ' lbs left' + (p.contents === 'Shells' ? ' shells' : ''); } },
          { key: 'lbs', label: 'Weight used', type: 'number', unit: 'lbs', required: true, min: 0.1, max: MLIMITS.arrivalLbs.max, step: 0.1, dependsOn: 'package',
            default: function (d, ctx) { var p = ctx && d.package ? findIn(ctx.known('package'), d.package) : null; return p ? String(pkgLeft(p)) : ''; },
            help: 'Starts at what is left in the package. Change it if only part goes in.' },
          { key: 'emptied', label: 'Does this empty the package?', type: 'yesno', dependsOn: 'package',
            default: function (d, ctx) { var p = ctx && d.package ? findIn(ctx.known('package'), d.package) : null; return p && num(d.lbs) !== '' && Number(d.lbs) >= pkgLeft(p) - 0.05 ? 'Yes' : 'No'; } },
        ] },
        { key: 'sugar_lbs', label: 'Sugar', type: 'number', unit: 'lbs', min: MLIMITS.sugar.min, max: MLIMITS.sugar.max, step: 0.1, showIf: chocAnswers, paperNote: 'Chocolate only' },
        { key: 'butter_lbs', label: 'Cocoa butter added', type: 'number', unit: 'lbs', min: MLIMITS.butter.min, max: MLIMITS.butter.max, step: 0.1, showIf: chocAnswers, paperNote: 'Chocolate only' },
        { key: 'target_micron', label: 'Target fineness', type: 'number', unit: 'microns', min: MLIMITS.micron.min, max: MLIMITS.micron.max, warnMin: MLIMITS.micron.warnMin, warnMax: MLIMITS.micron.warnMax, showIf: chocAnswers, paperNote: 'Chocolate only' },
        { key: 'other', fold: true, label: 'Anything else added', type: 'text', placeholder: 'e.g. vanilla, milk powder' },
        { key: 'other_lbs', fold: true, label: 'Weight of anything else', type: 'number', unit: 'lbs', min: MLIMITS.otherLbs.min, max: MLIMITS.otherLbs.max, step: 0.1 },
        { key: 'notes', fold: true, label: 'Notes', type: 'textarea' },
      ],
      // the nib : sugar ratio is worked out from the weights, never typed
      live: { after: 'sugar_lbs', text: function (d, ctx) {
        if (!chocAnswers(d)) return '';
        var nib = nibInputsLbs(d, ctx), r = nibSugar(nib, d.sugar_lbs); // shells packages are not nibs
        return r ? 'Nibs : sugar  ' + r + '   (' + nib + ' lbs nibs, ' + num(d.sugar_lbs) + ' lbs sugar)' : 'Add the packages and the sugar weight to see the nibs : sugar ratio.';
      } },
      check: function (d, ctx) {
        var out = { errors: [], warnings: [] }, known = ctx.known('package'), seen = Object.create(null);
        if (d.batch_id && seenIds(ctx, 'batch').indexOf(String(d.batch_id)) >= 0) out.errors.push({ key: 'batch_id', msg: 'Batch ' + d.batch_id + ' is already used. The next free number is ' + nextBatchId(d.date, seenIds(ctx, 'batch')) + '.' });
        (d.inputs || []).forEach(function (x, i) {
          var k = 'inputs.' + i + '.', p = findIn(known, x.package);
          if (x.package && seen[x.package]) out.errors.push({ key: k + 'package', msg: 'Package ' + x.package + ' is listed twice. Add its weights together.' });
          seen[x.package] = true;
          if (!p) return;
          if (!p.arrived) out.warnings.push({ key: k + 'package', msg: 'Package ' + p.id + ' has not been checked in yet.' });
          var left = pkgLeft(p), n = num(x.lbs);
          if (n !== '' && n > left + MLIMITS.usedSlack) out.warnings.push({ key: k + 'lbs', msg: 'That is more than the ' + left + ' lbs left in package ' + p.id + '.' });
          if (x.emptied === 'Yes' && n !== '' && left - n > MLIMITS.arrivalDiffLbs) out.warnings.push({ key: k + 'emptied', msg: 'Package ' + p.id + ' would still have ' + r1(left - n) + ' lbs left. Is it really empty?' });
          if (x.emptied !== 'Yes' && n !== '' && n >= left - 0.05 && left > 0) out.warnings.push({ key: k + 'emptied', msg: 'This is all that is left in package ' + p.id + '. Does it empty the package?' });
        });
        return out;
      },
      makes: function (d) {
        var nib = inputsLbs(d);
        // nib_lbs is left to the Sheet: a shells package is not nibs, and makes() does not know what each package holds
        return [{ kind: 'batch', id: d.batch_id, item: { start_date: d.date, destination: d.destination, finished: false, nib_lbs: null,
          in_lbs: r1(nib + (num(d.sugar_lbs) || 0) + (num(d.butter_lbs) || 0) + (num(d.other_lbs) || 0)) } }];
      },
      marks: function (d) {
        return (d.inputs || []).map(function (x) { return { kind: 'package', id: x.package, add: { used_lbs: num(x.lbs) || 0 }, set: x.emptied === 'Yes' ? { emptied: true } : {} }; });
      },
      summary: function (d) { return 'Batch ' + d.batch_id + ' · ' + d.destination + ' · ' + inputsLbs(d) + ' lbs from packages'; },
      toOps: function (d) {
        return [{ op: 'append', tab: 'Batches', row: { 'Batch ID': d.batch_id, 'Start date': d.date, 'Destination': d.destination, 'Recipe': d.recipe || '',
          'Sugar lbs': num(d.sugar_lbs), 'Cocoa butter lbs': num(d.butter_lbs), 'Other ingredients': d.other || '', 'Other lbs': num(d.other_lbs), 'Target micron': num(d.target_micron), 'Notes': d.notes || '' } }]
          .concat((d.inputs || []).map(function (x) { return { op: 'append', tab: 'Batch inputs', row: { 'Batch ID': d.batch_id, 'Package ID': x.package, 'Lbs used': num(x.lbs), 'Emptied': x.emptied === 'Yes' ? 'Yes' : '' } }; }));
      },
    },
    {
      id: 'batch_finish', area: 'making', title: 'Finish batch', hint: 'Out of the grinder', icon: 'flag',
      fields: [
        { key: 'batch', label: 'Batch', type: 'ref', of: 'batch', required: true, pattern: BATCH_PATTERN, patternHelp: 'A batch ID looks like ' + MAKING.prefix + '26-001',
          open: function (b) { return !b.finished; },
          itemText: function (b) { return b.id + (b.destination ? ' · ' + b.destination : '') + (b.start_date ? ' · started ' + dayWords(b.start_date) : ''); } },
        { key: 'destination', label: 'Made for', type: 'text', readonly: true, dependsOn: 'batch', default: function (d, ctx) { return destOf(d, ctx); }, showIf: function (d) { return !!d.destination; }, paperNote: 'Write what the batch is for' },
        { key: 'date', label: 'Finish date', type: 'date', default: 'today', required: true },
        // chocolate only (or while the batch is not known on this device, so nothing is lost)
        { key: 'hours_to_target', label: 'Time to reach the target fineness', type: 'number', unit: 'hours', min: MLIMITS.hoursToTarget.min, max: MLIMITS.hoursToTarget.max, step: 0.5, showIf: function (d) { return !d.destination || isChoc(d.destination); }, paperNote: 'Chocolate only' },
        { key: 'final_micron', label: 'Fineness reached', type: 'number', unit: 'microns', min: MLIMITS.micron.min, max: MLIMITS.micron.max, showIf: function (d) { return !d.destination || isChoc(d.destination); }, paperNote: 'Chocolate only' },
        { key: 'conche_hours', label: 'Conching time', type: 'number', unit: 'hours', min: MLIMITS.concheHours.min, max: MLIMITS.concheHours.max, warnMax: MLIMITS.concheHours.warnMax, step: 0.5, showIf: function (d) { return !d.destination || isChoc(d.destination); }, paperNote: 'Chocolate only' },
        { key: 'conche_temp', label: 'Conching temperature', type: 'number', unit: TEMP, min: MLIMITS.concheTemp.min, max: MLIMITS.concheTemp.max, warnMin: MLIMITS.concheTemp.warnMin, warnMax: MLIMITS.concheTemp.warnMax, showIf: function (d) { return !d.destination || isChoc(d.destination); }, paperNote: 'Chocolate only' },
        // cocoa butter and tea balls: the temperature that matters is the grinder's or the press's
        { key: 'process_temp', label: 'Grinder or press temperature', type: 'number', unit: TEMP, min: MLIMITS.processTemp.min, max: MLIMITS.processTemp.max, showIf: function (d) { return !!d.destination && !isChoc(d.destination); }, paperNote: 'Cocoa butter, tea balls and other' },
        { key: 'output_lbs', label: 'What came out', type: 'number', unit: 'lbs', min: MLIMITS.output.min, max: MLIMITS.output.max, step: 0.1 },
        { key: 'output_units', label: 'Bars or pieces made', type: 'number', min: 0, max: 100000, inputmode: 'numeric', help: 'Bars, tea balls or any other pieces you counted.' },
        { key: 'notes', label: 'Notes', type: 'textarea', help: 'How it tasted, anything you would change next time.' },
      ],
      check: function (d, ctx) {
        var out = { errors: [], warnings: [] }, b = findIn(ctx.known('batch'), d.batch), n = num(d.output_lbs);
        if (b && n !== '' && b.in_lbs && n > b.in_lbs + MLIMITS.usedSlack) out.warnings.push({ key: 'output_lbs', msg: 'More came out (' + n + ' lbs) than went in (' + r1(b.in_lbs) + ' lbs).' });
        if (b && b.start_date && d.date && d.date < b.start_date) out.warnings.push({ key: 'date', msg: 'The finish date is before the start date (' + b.start_date + ').' });
        return out;
      },
      confirm: function (d) { return 'This marks batch ' + d.batch + ' as finished. Is that right?'; },
      marks: function (d) { return [{ kind: 'batch', id: d.batch, set: { finished: true } }]; },
      summary: function (d) { return 'Batch ' + d.batch + ' finished' + (d.output_lbs ? ' · ' + d.output_lbs + ' lbs out' : ''); },
      toOps: function (d) {
        var set = { 'Finish date': d.date, 'Hours to target': num(d.hours_to_target), 'Final micron': num(d.final_micron), 'Conche hours': num(d.conche_hours) };
        set['Conche temp ' + TEMP] = num(d.conche_temp); set['Process temp ' + TEMP] = num(d.process_temp);
        set['Output lbs'] = num(d.output_lbs); set['Output units'] = num(d.output_units); set['Finish notes'] = d.notes || '';
        return [{ op: 'update', tab: 'Batches', key: d.batch, set: set }];
      },
    }
  );

  /* ---------------- Tasting notes (2.4.0) ----------------
   * One form for every area: tasting happens at all three flavour control points (fermenting and drying, roasting, conching in Walpole),
   * so it is offered to anyone with any area ticked, and to admins. A note is about a ferment, a roast, a package or a Walpole batch
   * (the history pages open this form with the right one picked). Everything is optional except what it is about.
   * catalog (master menu): "kind" and the one picker that shows are core; every other question here is optional.
   */
  var TASTING = {
    kinds: ['Ferment', 'Roast', 'Package', 'Batch'], // what the Sheet's "Ref kind" says
    kindLabels: { Batch: 'Chocolate batch' },        // what people read
    kindAreas: { Ferment: 'fermentation', Roast: 'roasting', Package: 'roasting', Batch: 'making' }, // a kind is offered only while its area is on (Settings → What you track)
    sampleFor: { Ferment: 'Beans', Roast: 'Nibs', Package: 'Nibs', Batch: 'Chocolate' }, // the usual thing tasted at each: a starting answer (only if on the Tasting sample list)
    score: { min: 1, max: 10 },
    recentDays: 60,                                  // ferments finished longer ago than this sit behind "Older or other…"
  };
  function tastingKind(d) { return d && TASTING.kinds.indexOf(d.kind) >= 0 ? d.kind : ''; }
  function tastingRef(d) { var k = tastingKind(d); return k === 'Ferment' ? d.ferment : k === 'Roast' ? d.roast : k === 'Package' ? d.package : k === 'Batch' ? d.batch : ''; }
  function tastingKindIs(kind) { return function (d) { return d.kind === kind; }; }
  function noteIdFrom(entryId) { var h = String(entryId || '').replace(/[^0-9a-f]/gi, '').toLowerCase(); while (h.length < 10) h += Math.floor(Math.random() * 16).toString(16); return 'TN-' + h.slice(0, 10); }
  /** A ferment still in the boxes, or bagged lately: the ones offered first. */
  function tastingFermentOpen(f) {
    if (!f.bagged_date && (f.dry_lbs === null || f.dry_lbs === undefined || f.dry_lbs === '')) return true;
    var t = Date.parse(f.bagged_date || '');
    return !isNaN(t) && Date.now() - t < TASTING.recentDays * 864e5;
  }

  FORMS.push(
    {
      id: 'tasting_note', area: AREAS.slice(), group: 'Tasting', stage: 'tasting', title: 'Tasting note', hint: 'How beans, nibs or chocolate taste', icon: 'cookie',
      fields: [
        { key: 'kind', label: 'What is the note about?', type: 'choice', options: TASTING.kinds, optionLabels: TASTING.kindLabels, optionAreas: TASTING.kindAreas, required: true },
        { key: 'ferment', label: 'Ferment', type: 'ferment', required: true, showIf: tastingKindIs('Ferment'), onlyIfArea: 'fermentation', paperNote: 'Only for a ferment', open: tastingFermentOpen },
        { key: 'roast', label: 'Roast', type: 'ref', of: 'roast', required: true, showIf: tastingKindIs('Roast'), onlyIfArea: 'roasting', paperNote: 'Only for a roast', pattern: ID_PATTERNS.roast, patternHelp: 'A roast ID looks like R3.1 (or 3.4-R2 from before)',
          itemText: function (r) { return r.id + (r.date ? ' · ' + dayWords(r.date) : '') + (r.beans_in ? ' · ' + r.beans_in + ' lbs' : ''); } },
        { key: 'package', label: 'Package', type: 'ref', of: 'package', required: true, showIf: tastingKindIs('Package'), onlyIfArea: 'roasting', paperNote: 'Only for a package', pattern: ID_PATTERNS.package, patternHelp: 'A package ID looks like R3.1-P1 (or 3.4-R2-P1 from before)',
          itemText: function (p) { return p.id + (p.lbs ? ' · ' + p.lbs + ' lbs' : '') + (p.contents === 'Shells' ? ' shells' : ''); } },
        { key: 'batch', label: 'Batch', type: 'ref', of: 'batch', required: true, showIf: tastingKindIs('Batch'), onlyIfArea: 'making', paperNote: 'Only for a batch', pattern: BATCH_PATTERN, patternHelp: 'A batch ID looks like ' + MAKING.prefix + '26-001',
          itemText: function (b) { return b.id + (b.destination ? ' · ' + b.destination : '') + (b.start_date ? ' · started ' + dayWords(b.start_date) : ''); } },
        { key: 'date', label: 'Date', type: 'date', default: 'today' }, // catalog: optional
        { key: 'taster', label: 'Tasted by', type: 'text', default: function (d, ctx) { return ctx && ctx.person ? ctx.person : ''; } }, // catalog: optional
        { key: 'sample', label: 'What was tasted', type: 'choice', list: 'Tasting sample', hideIfEmpty: true, noneLabel: 'Not said', dependsOn: 'kind', // catalog: optional
          default: function (d, ctx) { var w = TASTING.sampleFor[tastingKind(d)]; return w && ctx && ctx.list && ctx.list('Tasting sample').indexOf(w) >= 0 ? w : ''; } },
        { key: 'score', label: 'Overall score', type: 'number', min: TASTING.score.min, max: TASTING.score.max, step: 0.5, inputmode: 'decimal', unit: 'out of 10', help: '1 is poor, 10 is perfect. Leave it empty if you would rather not score it.' }, // catalog: optional
        { key: 'flavours', label: 'Flavour words', type: 'chips', list: 'Flavour', help: 'Tap any that fit. "Other…" adds your own.' }, // catalog: optional
        { key: 'off', label: 'Is something off?', type: 'yesno', help: 'Yes for a funky taste or smell that should be looked into. It shows highlighted on the history pages and the dashboard.' }, // catalog: optional
        { key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'What you noticed' }, // catalog: optional
      ],
      prepare: function (d, ctx, prev) { return { note_id: prev && prev.note_id ? prev.note_id : noteIdFrom(ctx && ctx.entry) }; }, // made on the phone from the entry's own ID: kept when the same entry is saved again
      // 2.4.2: flavour words are kept in one cell, apart by commas, so a word typed with "Other…" cannot hold a comma (it would show as two)
      check: function (d, ctx) {
        var listed = ctx && typeof ctx.list === 'function' ? ctx.list('Flavour') || [] : [];
        var bad = (d.flavours || []).filter(function (w) { return /,/.test(String(w)) && listed.indexOf(w) < 0; });
        return { errors: bad.length ? [{ key: 'flavours', msg: 'Leave out the comma in "' + bad[0] + '": untick it and add each flavour on its own.' }] : [], warnings: [] };
      },
      preparedProblem: function (d) { return /^TN-[0-9a-f]{10}$/.test(String(d.note_id || '')) ? '' : 'The note has no number. Tap Save again.'; },
      summary: function (d) {
        var k = tastingKind(d), what = TASTING.kindLabels[k] || k;
        return 'Tasting note · ' + (what ? what.toLowerCase() + ' ' : '') + tastingRef(d) + (num(d.score) !== '' ? ' · ' + num(d.score) + '/10' : '') + (d.off === 'Yes' ? ' · something off' : '');
      },
      toOps: function (d) {
        var k = tastingKind(d);
        if (!k) throw new Error('Say what the note is about.');
        if (!/^TN-[0-9a-f]{10}$/.test(String(d.note_id || ''))) throw new Error('The note has no number. Tap Save again.');
        return [{ op: 'append', tab: 'Tasting notes', row: {
          'Note ID': d.note_id, 'Ref kind': k, 'Ref ID': tastingRef(d), 'Date': d.date || '', 'What was tasted': d.sample || '', 'Tasted by': d.taster || '',
          'Score': num(d.score), 'Flavours': join(d.flavours), 'Something off': d.off === 'Yes' ? 'Yes' : '', 'Notes': d.notes || '',
        } }];
      },
    }
  );


  /* ---------------- The master menu: what each company tracks (2.3.0: Settings → What you track) ----------------
   * Batchstory defines the full menu of what can be tracked: the areas of the work (stages), the forms, and the questions on
   * them. Each company switches menu items on or off; companies never add their own questions (deliberately not supported).
   * Every question of every form is one of two kinds (a test fails if a new question has neither):
   *   core      never switched off: IDs, the links between stages, the weights and dates the stock numbers, ✱ formulas,
   *             model.js, toOps, prepare or check depend on, and anything whose absence would change a dashboard number.
   *   optional  on the menu: a company may switch it off (or on). A switched-off question is not shown, not asked for, not
   *             checked, and its Sheet columns (the list after it) are left out of the entry, so those cells simply stay blank
   *             (an update leaves the cell as it was). with: the switch it follows (juice unit goes with juice).
   *             words: what the Settings page calls the switch. default: 'off' for a menu item a company must switch on
   *             itself (a new question then starts off for every company); without it, 'on'.
   * CLASSIFYING A NEW QUESTION IS ONE LINE in MENU below: add its path to its form's core list, or one line to optional:
   *   'aroma': ['Aroma']                                   on unless a company switches it off
   *   'aroma': { cols: ['Aroma'], default: 'off' }         off until a company switches it on
   * A new form: one entry (core, optional) here, plus switch: { default: 'on'|'off' } if a company may switch the whole form;
   * without switch the form is on whenever its area is. Areas: AREA_DEFAULTS. Everything that exists today defaults to on.
   * Nothing is ever deleted: entries and tabs stay, and switching back on brings everything back. An entry already saved on a
   * phone is sent exactly as it was saved. The company's choices come from the server (config.js CH_CONFIG.fieldOn / formOn /
   * areaOn, kept on the device). Code.gs CFG.MENU and CFG.AREA_DEFAULTS list the same menu and defaults (a test checks).
   * Paths: a question inside a repeat is "<repeat key>.<key>" (deliveries.pick_dates).
   */
  var AREA_DEFAULTS = { fermentation: 'on', roasting: 'on', making: 'on' };
  var TEMP_COLS = function (prefix) { return [1, 2, 3, 4, 5].map(function (i) { return prefix + ' ' + i + ' °C'; }); };
  var MENU = {
    new_ferment: {
      core: ['ferment', 'date', 'deliveries', 'deliveries.farm', 'deliveries.lbs', 'deliveries.price'],
      optional: { time: ['Load time'], station: ['Station'], box_type: ['Box type'], plan: ['Ferment plan'],
        'deliveries.paid_to': ['Paid to'], 'deliveries.bucket_weights': { cols: ['Bucket weights'], words: 'Bucket by bucket weights' }, 'deliveries.buckets': ['Buckets'], 'deliveries.pick_dates': ['Pick dates'],
        juice: { cols: ['Juice lbs', 'Juice litres', 'Juice gallons'], words: 'Juice taken (and its unit)' }, juice_unit: { with: 'juice', cols: [] },
        brix: ['Brix'], additions: ['Additions'], notes: ['Notes'] },
    },
    ferment_check: {
      core: ['ferment', 'date', 'stage', 'box'],
      optional: { time: ['Time', 'Unload time'], top: TEMP_COLS('Top'), centre: TEMP_COLS('Centre'), colour: ['Colour'], smell: ['Smell'],
        ridges: { cols: ['Interior (cut test)'], words: 'Cut test (ridges and centre colour)' }, centre_colour: { with: 'ridges', cols: ['Interior (cut test)'] },
        problems: ['Problems'], added: ['Added'], drying_setup: ['Drying setup'], notes: ['Notes'] },
    },
    drying_check: {
      core: ['ferment', 'date', 'outside', 'inside'], // outside and inside dry give the drying days on the dashboard (P1-C: outside is Wet / Sticky / Dry)
      optional: { location: ['Location'], setup: { cols: ['Drying setup type'], words: 'Setup (tent or drawers)', default: 'off' }, weather: ['Weather'],
        tent_temp: ['Tent temp °C'], tent_humidity: ['Tent humidity %'],
        exterior: { cols: ['Exterior dry %'], words: 'Outside dry (0 to 100%)', default: 'off' }, sticky: { cols: ['Sticky'], default: 'off' },
        mold: ['Mold or bloom'], treatment: ['Treatment'], speed: ['Drying speed'], moisture: ['Moisture %'], notes: ['Observation'] },
    },
    add_beans: {
      core: ['ferment', 'date', 'farm', 'lbs', 'price'],
      optional: { paid_to: ['Paid to'], bucket_weights: { cols: ['Bucket weights'], words: 'Bucket by bucket weights' }, buckets: ['Buckets'], pick_dates: ['Pick dates'], note: ['Note'] },
    },
    finish_drying: {
      core: ['ferment', 'exterior_date', 'interior_date', 'dry_lbs', 'bagged_date', 'bags'],
      optional: { moisture: ['Final moisture %', 'Moisture %'],
        cut_ridges: { cols: ['Cut test (after drying)'], words: 'Cut test after drying (ridges, centre colour, note)' }, cut_centre: { with: 'cut_ridges', cols: ['Cut test (after drying)'] }, cut_note: { with: 'cut_ridges', cols: ['Cut test note'] },
        bag_labels: ['Bag labels'], notes: ['Observation'] },
    },
    roast: {
      core: ['roast_id', 'inputs', 'inputs.ferment', 'inputs.lbs', 'inputs.last', 'date', 'roasted_lbs'], // P2-A: "Beans from" (each line a ferment, its lbs, last of it)
      optional: { roaster: ['Roaster'], profile: { cols: ['Roast plan'], words: 'Roast profile' }, bean_size: ['Bean size'],
        start_time: { cols: ['Start time'], words: 'Beans loaded' }, finish_time: { cols: ['Finish time'], words: 'Beans finished' },
        max_temp: { cols: ['Max temp °C'], words: 'Max temperature' }, cooling_min: ['Cooling minutes'],
        smell: { cols: ['Smell'], words: '10-bean check (smell, taste, look)' }, taste: { with: 'smell', cols: ['Taste'] }, look: { with: 'smell', cols: ['Look'] }, quality_note: { with: 'smell', cols: ['Quality note'] },
        profile_achieved: { cols: ['Profile achieved'], words: 'Roast profile achieved?' }, log_ref: ['Roaster log ref'], notes: ['Notes'],
        max_temp_time: { cols: ['Max temp reached time'], words: 'When max temperature was reached', default: 'off' },
        start_temp: { cols: ['Start temp °C'], words: 'Starting temperature (and when it was reached)', default: 'off' }, start_temp_time: { with: 'start_temp', cols: ['Start temp reached time'] },
        roaster_loads: { cols: ['Roaster loads'], default: 'off' }, bags_opened: { cols: ['Bags opened'], default: 'off' } },
    },
    winnow: { core: ['roast', 'date', 'nib_lbs', 'shell_lbs'], optional: { notes: ['Winnow notes'] } },
    pack: { core: ['roast', 'date', 'contents', 'groups', 'groups.lbs', 'groups.count', 'groups.for', 'last_of_roast'], optional: { 'groups.package_type': ['Package type'], notes: ['Notes'] } },
    ship: { core: ['date', 'packages'], optional: { destination: ['Destination'], carrier: ['Carrier'], tracking: ['Tracking'], notes: ['Notes'] } }, // P2-E: one pallet
    ship_left: { core: ['shipment', 'date'], optional: { tracking: ['Tracking'] } }, // P2-E
    local_use: { core: ['package', 'date', 'used_for', 'lbs', 'emptied'], optional: { notes: ['Notes'] }, 'switch': { 'default': 'off' } }, // P2-F: the first form on the menu by itself; it starts off
    arrival: { core: ['package', 'date', 'arrival_lbs'], optional: { smell: ['Smell'], taste: ['Taste'], look: ['Look'], notes: ['Notes'] } },
    batch_start: {
      core: ['batch_id', 'date', 'destination', 'inputs', 'inputs.package', 'inputs.lbs', 'inputs.emptied', 'sugar_lbs', 'butter_lbs', 'other_lbs'], // every weight goes into the batch's total and nib : sugar
      optional: { recipe: ['Recipe'], target_micron: ['Target micron'], other: ['Other ingredients'], notes: ['Notes'] },
    },
    batch_finish: {
      core: ['batch', 'destination', 'date', 'output_lbs'],
      optional: { hours_to_target: ['Hours to target'], final_micron: ['Final micron'], conche_hours: ['Conche hours'], conche_temp: ['Conche temp ' + TEMP],
        process_temp: ['Process temp ' + TEMP], output_units: ['Output units'], notes: ['Finish notes'] },
    },
    tasting_note: { // 2.4.0: core is what the note is about (the kind and its one picker; the note ID is made by prepare); everything else is optional, on by default
      core: ['kind', 'ferment', 'roast', 'package', 'batch'],
      optional: { date: ['Date'], taster: ['Tasted by'], sample: ['What was tasted'], score: ['Score'], flavours: ['Flavours'], off: ['Something off'], notes: ['Notes'] },
    },
  };
  /*
   * P4-A: photo questions. A photo is taken with the camera, kept on the phone (docs/photos.js) and sent after its entry;
   * the answer is only [photo_id] and toOps writes no column for it (cols: []). Each starts off on the master menu, and is
   * shown only while the server says photos are switched on (company.photos; see fieldOn). Added last on each form.
   */
  (function photoQuestions() {
    var add = { ferment_check: [['photo_beans', 'Photo of the beans'], ['photo_cut', 'Photo of the cut test']], drying_check: [['photo', 'Photo of the beans']], finish_drying: [['photo_cut', 'Photo of the cut test']] };
    Object.keys(add).forEach(function (id) {
      var form = FORMS.filter(function (f) { return f.id === id; })[0];
      if (!form || !MENU[id]) return;
      add[id].forEach(function (q) {
        form.fields.push({ key: q[0], label: q[1], type: 'photo', max: 1 });
        MENU[id].optional[q[0]] = { cols: [], default: 'off' };
      });
    });
  })();
  // Each field learns its kind, its columns and its place (form, path). The place is not enumerable, so it never travels in JSON.
  FORMS.forEach(function (form) {
    var t = MENU[form.id] || { core: [], optional: {} };
    (function stamp(fields, prefix) {
      fields.forEach(function (f) {
        var path = prefix + f.key, o = t.optional[path];
        Object.defineProperty(f, '__form', { value: form.id, enumerable: false, configurable: true });
        Object.defineProperty(f, '__path', { value: path, enumerable: false, configurable: true });
        if (o) {
          f.tier = 'optional';
          f.cols = Array.isArray(o) ? o : o.cols || [];
          if (!Array.isArray(o) && o.with) f.partOf = o.with;
          if (!Array.isArray(o) && o.words) f.trackWords = o.words;
          f.dflt = !Array.isArray(o) && o.default === 'off' ? 'off' : 'on';
        } else if (t.core.indexOf(path) >= 0) f.tier = 'core';
        if (f.type === 'repeat') stamp(f.fields, path + '.');
      });
    })(form.fields, '');
    var byPath = {};
    eachField(form, function (f, p) { byPath[p] = f; });
    eachField(form, function (f, p) { if (f.partOf) Object.defineProperty(f, '__main', { value: byPath[p.replace(/[^.]+$/, f.partOf)], enumerable: false, configurable: true }); });
  });
  /** Is this question shown? Core questions always; an optional one as this company chose, else as the menu's default. */
  function fieldOn(f) {
    if (!f || f.tier !== 'optional' || !f.__form) return true;
    if (f.type === 'photo' && !(CONF && CONF.photos === true)) return false; // P4-A: only while the server says photos are on (company.photos)
    var main = f.__main || f; // juice unit follows juice
    if (!CONF || typeof CONF.fieldOn !== 'function') return main.dflt !== 'off';
    return CONF.fieldOn(f.__form, main.__path, main.dflt);
  }
  /** Is this area of the work switched on (as the company chose, else its default)? */
  function areaOn(a) { var k = areaKey(a) || a; return !CONF || typeof CONF.areaOn !== 'function' ? AREA_DEFAULTS[k] !== 'off' : CONF.areaOn(k, AREA_DEFAULTS[k]); }
  /**
   * 2.4.0: the fixed options of a choice that are offered now. A field with optionAreas ({option: area}) offers an option only while its
   * area is on for the company (Tasting note: Roast and Package with Roasting, Chocolate batch with Making). current: an answer already
   * given (a draft, a pre-filled link) stays offered, so nothing typed is lost. The server still takes any option.
   */
  function optionsOf(f, current) {
    var o = (f && f.options) || [];
    if (!f || !f.optionAreas) return o;
    return o.filter(function (x) { var a = f.optionAreas[x]; return !a || areaOn(a) || (current !== undefined && current !== null && current !== '' && x === current); });
  }
  /**
   * P4-B/2: the questions a paper form prints, top level, in order, each with the number printed before it (a list of
   * deliveries has none: its questions print in groups). paper.js prints these numbers and scan.js sends the same ones to the
   * reader, so the reader's labels match the paper. A photo question is never on paper; nor a question switched off, or one only
   * for an area that is off.
   */
  function onPaper(f) { return f.type !== 'photo' && fieldOn(f) && (!f.onlyIfArea || areaOn(f.onlyIfArea)); }
  function paperFields(form) { var n = 0; return ((form && form.fields) || []).filter(onPaper).map(function (f) { return { field: f, n: f.type === 'repeat' ? 0 : ++n }; }); }
  /** Is this form on the phones: its area is on and, for a form on the menu by itself, the company has it on? */
  function formOn(form) {
    if (!form) return true;
    if (![].concat(form.area || []).some(areaOn)) return false; // 2.4.0: a form of several areas (Tasting note) stays while any of them is on
    var sw = MENU[form.id] && MENU[form.id].switch;
    if (!sw) return true;
    return !CONF || typeof CONF.formOn !== 'function' ? sw.default !== 'off' : CONF.formOn(form.id, sw.default);
  }
  /** Every question of a form, inside repeats too, with its path. */
  function eachField(form, fn) { (function walk(fields) { fields.forEach(function (f) { fn(f, f.__path || f.key); if (f.type === 'repeat') walk(f.fields); }); })(form.fields); }
  /** The switches of a form for the Settings page: [{key, label, fields: [the questions it hides], default}], in the form's order. */
  function switches(form) {
    var out = [], later = [];
    eachField(form, function (f, path) {
      if (f.tier !== 'optional') return;
      if (f.partOf) later.push([f, path.replace(/[^.]+$/, f.partOf)]); // its main question may come after it (Roast: the time, then the temperature)
      else out.push({ key: path, label: f.trackWords || f.label, fields: [f], default: f.dflt });
    });
    later.forEach(function (x) { out.forEach(function (s) { if (s.key === x[1]) s.fields.push(x[0]); }); });
    return out;
  }
  /** The Sheet columns this company leaves blank for a form: those of its hidden questions. */
  function hiddenCols(form) {
    var cols = [];
    eachField(form, function (f) { if (f.tier === 'optional' && !fieldOn(f)) (f.cols || []).forEach(function (c) { if (cols.indexOf(c) < 0) cols.push(c); }); });
    return cols;
  }
  /**
   * toOps for a new entry: the form's own toOps, with the columns of hidden questions left out (an append leaves them blank,
   * an update leaves them as they were). With nothing hidden it is exactly toOps (the snapshot test).
   */
  function opsFor(form, d) {
    var cols = hiddenCols(form);
    if (!cols.length) return form.toOps(d);
    var clean = {};
    for (var k0 in d) clean[k0] = d[k0];
    form.fields.forEach(function (f) { // the answers of hidden questions are dropped first (an old draft may still hold one)
      if (f.type === 'repeat' && Array.isArray(clean[f.key])) clean[f.key] = clean[f.key].map(function (it) { var o = {}; for (var k1 in it) o[k1] = it[k1]; f.fields.forEach(function (s) { if (!fieldOn(s)) delete o[s.key]; }); return o; });
      else if (!fieldOn(f)) delete clean[f.key];
    });
    var ops = form.toOps(clean);
    return ops.map(function (op) {
      var o = {}, k;
      for (k in op) o[k] = op[k];
      ['row', 'set'].forEach(function (part) {
        if (!op[part]) return;
        o[part] = {};
        for (var c in op[part]) if (cols.indexOf(c) < 0) o[part][c] = op[part][c];
      });
      return o;
    }).filter(function (op) { return !(op.op === 'update' && op.set && !Object.keys(op.set).length); });
  }
  /** A message key ("inputs.0.lbs") points at a hidden question? Then its warning is not shown. */
  function hiddenKey(form, key) {
    var path = String(key || '').replace(/\.\d+\./g, '.'), hit = false;
    if (!form || !form.fields) return false;
    eachField(form, function (f, p) { if (p === path && !fieldOn(f)) hit = true; });
    return hit;
  }

  /* ---------- checks that need no network ---------- */

  function visible(field, data) { return fieldOn(field) && (!field.showIf || field.showIf(data)); }

  /** Returns {errors: [{key,msg}], warnings: [{key,msg}]}. With ctx, the form's own check(d, ctx) is added. */
  function validate(form, data, ctx) {
    var errors = [], warnings = [];
    function check(fields, d, prefix) {
      fields.forEach(function (f) {
        if (!visible(f, d)) return;
        var v = d[f.key], key = prefix + f.key;
        var empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.filter(function (x) { return x !== '' && x !== null; }).length === 0);
        if (f.type === 'repeat') {
          var items = v || [];
          if (items.length < (f.min || 0)) errors.push({ key: key, msg: 'Add at least ' + f.min + ' ' + f.itemLabel.toLowerCase() + '.' });
          items.forEach(function (it, i) { check(f.fields, it, key + '.' + i + '.'); });
          return;
        }
        if ((f.required || (f.requiredIf && f.requiredIf(d))) && empty) { errors.push({ key: key, msg: f.label + ' is needed.' }); return; }
        if (empty) return;
        if (f.pattern && !(Array.isArray(v) ? v : [v]).every(function (x) { return new RegExp(f.pattern).test(String(x)); })) errors.push({ key: key, msg: f.patternHelp || 'Check the format.' });
        if (f.type === 'ferment' && !/^\d+\.\d+$/.test(String(v))) errors.push({ key: key, msg: 'Ferment ID should look like 3.1 (season, dot, number).' });
        if (f.type === 'number') {
          var n = Number(v);
          if (isNaN(n)) errors.push({ key: key, msg: f.label + ' must be a number.' });
          else if ((f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) errors.push({ key: key, msg: f.label + ' should be between ' + f.min + ' and ' + f.max + '.' });
          else if ((f.warnMin !== undefined && n < f.warnMin) || (f.warnMax !== undefined && n > f.warnMax)) warnings.push({ key: key, msg: f.label + ' is ' + n + (f.unit ? ' ' + f.unit : '') + '. That looks unusual.' });
        }
        if (f.type === 'temps') {
          (v || []).forEach(function (t, i) {
            if (t === '' || t === null || t === undefined) return;
            var n = Number(t);
            if (isNaN(n)) errors.push({ key: key, msg: f.label + ' ' + (i + 1) + ' must be a number.' });
            else if (n < TEMP_RANGE.min || n > TEMP_RANGE.max) warnings.push({ key: key, msg: f.label.replace(' temperatures', '') + ' reading ' + (i + 1) + ' is ' + n + ' °C. That looks unusual.' });
          });
        }
        if (f.type === 'buckets') { // P1-A: each bucket a plain weight in range; at most maxItems of them
          var bl = bucketList({ bucket_weights: v });
          if (f.maxItems && bl.length > f.maxItems) errors.push({ key: key, msg: 'At most ' + f.maxItems + ' buckets. Remove some, or type the total below instead.' });
          bl.forEach(function (x, i) {
            var n = Number(x), what = 'Bucket ' + (i + 1);
            if (BUCKET_DECIMALS.test(x)) errors.push({ key: key, msg: what + ' has more than 2 decimals. Use at most 2, like 23.45.' });
            else if (!BUCKET_NUM.test(x) || isNaN(n)) errors.push({ key: key, msg: what + ' must be a number.' });
            else if (n < f.min || n > f.max) errors.push({ key: key, msg: what + ' should be between ' + f.min + ' and ' + f.max + ' ' + f.unit + '.' });
            else if (f.warnMax !== undefined && n > f.warnMax) warnings.push({ key: key, msg: what + ' is ' + n + ' ' + f.unit + '. That looks unusual.' });
          });
        }
        if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) errors.push({ key: key, msg: 'Pick a date.' });
      });
    }
    check(form.fields, data, '');
    if (ctx && typeof form.check === 'function') {
      var more = form.check(data, ctx) || {};
      errors = errors.concat(more.errors || []);
      warnings = warnings.concat(more.warnings || []);
    }
    // 2.3.0: a message about a question this company switched off is not shown (its answer is not sent either)
    var shown = function (m) { return !hiddenKey(form, m.key); };
    return { errors: errors.filter(shown), warnings: warnings.filter(shown) };
  }

  /** The forms a role may use: those of its areas (admin: all). A role with no areas (viewer, or unknown) has none. */
  function formsFor(role) {
    var areas = ROLE_AREAS.hasOwnProperty(role) ? ROLE_AREAS[role] : [];
    return FORMS.filter(function (f) { return formOn(f) && (role === 'admin' || [].concat(f.area || []).some(function (a) { return areas.indexOf(areaKey(a)) >= 0 && areaOn(areaKey(a)); })); }); // 2.3.0: not an area the company switched off
  }
  /** 2.0.0: the forms for a person's own areas (ticked on the People page; the server sends them with the link and in "me"). */
  function formsForAreas(areas) {
    var mine = [].concat(areas || []).map(areaKey).filter(Boolean);
    return FORMS.filter(function (f) { return formOn(f) && [].concat(f.area || []).some(function (a) { return mine.indexOf(areaKey(a)) >= 0 && areaOn(areaKey(a)); }); });
  }

  /**
   * Things of one kind a device knows: the Sheet's list (server), then what entries on this device made or
   * changed (entries oldest first, only those the Sheet's list may not include yet). Made here = local: true,
   * source: the entry that made it. Matched exactly as text ("3.1-R1" is not "3.10-R1").
   * idsOnly(e): true for an entry whose things exist but whose changes are not counted (default: held for review,
   * status 'review'): what it made is offered (its IDs stay taken, labels may be printed), but its marks (lbs used,
   * packed, emptied, finished…) are left out, so a held entry never makes "lbs left" too low.
   */
  function knownItems(kind, server, entries, idsOnly) {
    var only = typeof idsOnly === 'function' ? idsOnly : function (e) { return e.status === 'review'; };
    var out = (server || []).map(function (x) { var o = {}; for (var k in x) o[k] = x[k]; o.id = String(x.id); return o; });
    var byId = Object.create(null); // 2.4.2: keyed by IDs, no prototype (an ID like "__proto__" is only an ID)
    out.forEach(function (x) { byId[x.id] = x; });
    (entries || []).forEach(function (e) {
      var form = FORMS.filter(function (f) { return f.id === e.form; })[0];
      if (!form || !e.data) return;
      (typeof form.makes === 'function' ? form.makes(e.data) || [] : []).forEach(function (m) {
        if (m.kind !== kind || m.id === undefined || m.id === null || String(m.id) === '' || byId[String(m.id)]) return;
        var o = {};
        for (var k in (m.item || {})) o[k] = m.item[k];
        o.id = String(m.id); o.local = true; o.source = e.entry_id;
        if (e.status === 'review') o.held = true; // Phase 2 review M2: made by an entry held for review (not in the Sheet)
        byId[o.id] = o; out.push(o);
      });
      if (only(e)) return;
      (typeof form.marks === 'function' ? form.marks(e.data) || [] : []).forEach(function (m) {
        var it = m.kind === kind ? byId[String(m.id)] : null;
        if (it) {
          for (var k in (m.set || {})) it[k] = m.set[k];
          for (var a in (m.add || {})) it[a] = Math.round(((Number(it[a]) || 0) + m.add[a]) * 100) / 100; // e.g. lbs packed so far
        }
      });
    });
    return out;
  }

  /**
   * sources for an entry (rule 10, two devices that made the same new ID): {tab, id, entry} for every roast, package, batch…
   * the entry picks (its 'ref' fields, also inside repeats) that an entry on this device made, whatever that entry's status,
   * and even when the Sheet's list already has that ID (it may be another device's). The server holds the entry if the
   * Sheet's row with that ID came from a different entry. entries: this device's, newest first (the newest maker counts);
   * skip: the entry ID being saved (its own earlier copy is never its source).
   * P2-A: a ferment picked inside a list (a roast's "Beans from" lines) adds {tab: 'Ferments', id, entry} when a New ferment on
   * this device made it, whatever that entry's status; a form's own top-level ferment stays in ferment_source (fermentSource).
   */
  function refSources(form, d, entries, skip) {
    var out = [], makers = Object.create(null);
    (entries || []).forEach(function (e) {
      if (!e || !e.data || e.entry_id === skip) return;
      var f = FORMS.filter(function (x) { return x.id === e.form; })[0];
      (f && typeof f.makes === 'function' ? f.makes(e.data) || [] : []).forEach(function (m) {
        var k = m.kind + '|' + String(m.id);
        if (m.id !== undefined && m.id !== null && String(m.id) !== '' && !makers[k]) makers[k] = e.entry_id;
      });
    });
    // P2-A: a ferment picked inside a list (a roast's "Beans from" lines). A top-level ferment goes in ferment_source (fermentSource), as before.
    var fermentMaker = function (id) {
      var by = (entries || []).filter(function (e) { return e && e.form === 'new_ferment' && e.entry_id !== skip && e.data && String(e.data.ferment) === id; })[0];
      return by ? by.entry_id : '';
    };
    (function walk(fields, data, inList) {
      fields.forEach(function (f) {
        if (!visible(f, data)) return; // a pick left behind by a question that is not shown (Tasting note: one picker per kind) is not part of the entry
        if (f.type === 'repeat') { (data[f.key] || []).forEach(function (it) { walk(f.fields, it || {}, true); }); return; }
        if (f.type === 'ferment' && inList) {
          var fid = data[f.key] === undefined || data[f.key] === null ? '' : String(data[f.key]), fby = fid ? fermentMaker(fid) : '';
          if (fby && !out.some(function (o) { return o.tab === 'Ferments' && o.id === fid; })) out.push({ tab: 'Ferments', id: fid, entry: fby });
          return;
        }
        if (f.type !== 'ref' || !KINDS[f.of]) return;
        [].concat(data[f.key] === undefined || data[f.key] === null ? [] : data[f.key]).map(String).forEach(function (id) {
          var by = makers[f.of + '|' + id], tab = KINDS[f.of].tab;
          if (by && !out.some(function (o) { return o.tab === tab && o.id === id; })) out.push({ tab: tab, id: id, entry: by });
        });
      });
    })(form.fields, d || {}, false);
    return out;
  }

  /**
   * ferment_source for an entry (rule 10, as refSources for roasts and packages): {id, entry} when the ferment it picks
   * was made by an entry on this device (a New ferment), whatever that entry's status (waiting, sent, held for review)
   * and even when the Sheet's list already has that ID (it may be another device's box with the same ID). The server
   * holds the entry if the Sheet's ferment with that ID came from a different entry. entries: this device's, newest
   * first (the newest maker counts); skip: the entry ID being saved. null when no entry here made it.
   */
  function fermentSource(form, d, entries, skip) {
    if (!form || form.id === 'new_ferment') return null;
    d = d || {};
    var id = '';
    (form.fields || []).some(function (f) {
      if (f.type !== 'ferment' || !visible(f, d) || d[f.key] === undefined || d[f.key] === null || String(d[f.key]) === '') return false;
      id = String(d[f.key]);
      return true;
    });
    if (!id) return null;
    var by = (entries || []).filter(function (e) { return e && e.form === 'new_ferment' && e.entry_id !== skip && e.data && String(e.data.ferment) === id; })[0];
    return by ? { id: id, entry: by.entry_id } : null;
  }

  /**
   * Suggested ID for a new ferment: the next number in the current season.
   * season comes from the "Current season" list on the Sheet; without it, continue the highest season seen.
   * 2.16 → 2.17; with season "3" and nothing yet in season 3 → 3.1
   */
  function nextFermentId(ids, season) {
    var best = null, inSeason = 0;
    (ids || []).forEach(function (id) {
      var m = String(id).match(/^(\d+)\.(\d+)$/);
      if (!m) return;
      var s = Number(m[1]), n = Number(m[2]);
      if (season && s === Number(season)) inSeason = Math.max(inSeason, n);
      if (!best || s > best[0] || (s === best[0] && n > best[1])) best = [s, n];
    });
    if (season && /^\d+$/.test(String(season))) return season + '.' + (inSeason + 1);
    return best ? best[0] + '.' + (best[1] + 1) : '';
  }

  /*
   * Which script first takes what a phone sends (app 1.29.2, the 25 Nov review's H1). On a go-live the pages are live
   * within a minute but the script only after its tests, and an older script holds an entry with a column it does not
   * know ("Column … is missing"). So every entry records needs_script, the newest script version among what it writes
   * (needsScript), and the phone sends it only once the server says it is that version or newer (scriptReady). Until
   * then it simply stays waiting. Anything not listed here has been taken since script 2.7.7 or before.
   * WHEN YOU ADD a column, a tab, a form or a new entry field the script must understand, add it here with the script
   * version that first takes it. tests/script-gate.test.js fails until you do (handbook/agents.md).
   */
  var SCRIPT_NEEDS = {
    columns: { // 'Tab|Column'
      'Intakes|Bucket weights': '2.8.0',
      'Drying log|Exterior state': '2.8.0', 'Drying log|Drying setup type': '2.8.0',
      'Drying log|Tent temp °C': '2.12.0', 'Drying log|Tent humidity %': '2.12.0',
      'Ferments|Cut test (after drying)': '2.8.0', 'Ferments|Cut test note': '2.8.0',
      'Roasts|Bean size': '2.10.0', 'Roasts|Finish time': '2.10.0', 'Roasts|Smell': '2.10.0', 'Roasts|Taste': '2.10.0', 'Roasts|Look': '2.10.0',
      'Roasts|Quality note': '2.10.0', 'Roasts|Profile achieved': '2.10.0',
      'Packages|For': '2.10.0',
      'Shipments|Destination': '2.10.0', 'Shipments|Left port date': '2.10.0',
    },
    tabs: { 'Roast inputs': '2.10.0', 'Local use': '2.10.0' },
    forms: { roast: '2.10.0', ship_left: '2.10.0', local_use: '2.10.0' }, // new, or redone for the roasting redesign
    fields: { paper: '2.8.0' }, // an older script ignores "paper" and records the typing admin's name instead
  };
  /** The parts of a version ("2.10.0" → [2, 10, 0]), or null when it is not one. */
  function versionParts(v) { return typeof v === 'string' && /^\d{1,6}(\.\d{1,6}){0,3}$/.test(v) ? v.split('.').map(Number) : null; }
  /** Compare two versions part by part as numbers (2.10.0 is newer than 2.9.0): -1, 0 or 1; null when either is not a version. */
  function versionCmp(a, b) {
    var x = versionParts(a), y = versionParts(b);
    if (!x || !y) return null;
    for (var i = 0; i < Math.max(x.length, y.length); i++) {
      var p = x[i] || 0, q = y[i] || 0;
      if (p !== q) return p < q ? -1 : 1;
    }
    return 0;
  }
  function ownVal(o, k) { return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : ''; } // never "constructor" or "__proto__"
  /** The newest of two versions ('' counts as none). */
  function newerOf(a, b) { return a && (!b || versionCmp(a, b) > 0) ? a : b; }
  /** The newest script version an entry needs ('' when any script takes it), from its form, the tabs and columns its ops write, and its fields. */
  function needsScript(entry) {
    var need = '';
    function add(v) { if (versionParts(v)) need = newerOf(v, need); }
    if (!entry) return '';
    add(ownVal(SCRIPT_NEEDS.forms, String(entry.form)));
    Object.keys(SCRIPT_NEEDS.fields).forEach(function (k) { if (entry[k] !== undefined && entry[k] !== null) add(SCRIPT_NEEDS.fields[k]); });
    (entry.ops || []).forEach(function (op) {
      if (!op) return;
      add(ownVal(SCRIPT_NEEDS.tabs, String(op.tab)));
      var cells = op.op === 'update' ? op.set : op.row;
      Object.keys(cells || {}).forEach(function (h) { add(ownVal(SCRIPT_NEEDS.columns, op.tab + '|' + h)); });
    });
    return need;
  }
  /** The newest needs_script among these entries ('' when none needs one). */
  function newestNeed(rows) {
    var need = '';
    (rows || []).forEach(function (e) { if (e && versionParts(e.needs_script)) need = newerOf(e.needs_script, need); });
    return need;
  }
  /**
   * May this entry go to a server that says it is `version`? Yes when the entry needs nothing (or is from before 1.29.2),
   * when the version is not known (no answer yet, or not a version: send as before), or when it is new enough.
   */
  function scriptReady(entry, version) {
    var need = entry && entry.needs_script;
    if (!need || !versionParts(version) || !versionParts(need)) return true;
    return versionCmp(version, need) >= 0;
  }

  /**
   * Which of these waiting entries (oldest first, as the phone's queue gives them) go now to a server of `version`
   * (review M1). An entry is held back when it is itself too new (scriptReady), or when its ferment_source or any of its
   * sources names an entry already held: a Finish drying on a box whose New ferment waits, a Winnow of a roast whose Roast
   * waits. So nothing ever jumps ahead of the entry that made its box. held: the entry IDs held back, filled in here and
   * kept across calls (the phone checks each chunk again just before it goes, with the same set).
   */
  function holdBack(rows, version, held) {
    return (rows || []).filter(function (e) {
      var deps = [e.ferment_source && e.ferment_source.entry].concat((Array.isArray(e.sources) ? e.sources : []).map(function (s) { return s && s.entry; }));
      var after = deps.some(function (d) { return typeof d === 'string' && d && Object.prototype.hasOwnProperty.call(held, d); });
      if (after || !scriptReady(e, version)) { held[e.entry_id] = true; return false; }
      return true;
    });
  }

  var api = {
    SCRIPT_NEEDS: SCRIPT_NEEDS, versionCmp: versionCmp, needsScript: needsScript, scriptReady: scriptReady, newestNeed: newestNeed, holdBack: holdBack, // 1.29.2: entries wait for a new enough script
    FORMS: FORMS, DEFAULT_LISTS: DEFAULT_LISTS, validate: validate, visible: visible, nextFermentId: nextFermentId,
    formById: function (id) { return FORMS.filter(function (f) { return f.id === id; })[0]; },
    dayWords: dayWords,
    nextRoastId: nextRoastId, nextSeasonRoastId: nextSeasonRoastId, roastName: roastName, seasonOfRoast: seasonOfRoast, roastOfPackage: roastOfPackage, fermentOfOldId: fermentOfOldId,
    roastLines: roastLines, roastTotal: roastTotal, packRows: packRows, packageIds: packageIds, nextShipmentId: nextShipmentId, ID_PATTERNS: ID_PATTERNS, LIMITS: LIMITS,
    nextBatchId: nextBatchId, nibSugar: nibSugar, TASTING: TASTING, MOISTURE: MOISTURE, pkgLeft: pkgLeft, MAKING: MAKING, MLIMITS: MLIMITS, fermentLeft: fermentLeft, nibsLeft: nibsLeft, minutesOf: minutesOf,
    AREAS: AREAS, ROLE_AREAS: ROLE_AREAS, AREA_TITLES: AREA_TITLES, KINDS: KINDS, formsFor: formsFor, formsForAreas: formsForAreas, areaKey: areaKey, knownItems: knownItems, refSources: refSources, fermentSource: fermentSource,
    bucketList: bucketList, bucketSum: bucketSum, BUCKET_NUM: BUCKET_NUM, BUCKET_DECIMALS: BUCKET_DECIMALS, // P1-A: bucket-by-bucket weights
    MENU: MENU, AREA_DEFAULTS: AREA_DEFAULTS, fieldOn: fieldOn, formOn: formOn, areaOn: areaOn, optionsOf: optionsOf, onPaper: onPaper, paperFields: paperFields, switches: switches, hiddenCols: hiddenCols, opsFor: opsFor, eachField: eachField, // 2.3.0: what each company tracks
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CH = Object.assign(root.CH || {}, api);
})(typeof self !== 'undefined' ? self : this);
