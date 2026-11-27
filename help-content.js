/*
 * Help: every explanation in one place (app 1.22.2). The one source of the words: help.html draws `articles` (admins),
 * and the field app's Settings draws `field` (workers). Pages link to an article as help.html#<id>; tests/help.test.js
 * fails if a link names an id that is not here.
 *
 * Keep it plain and short, and in step with the owner sections of README.md. No names of real people, farms or prices.
 * Worker wording rules apply to `field`: never "the Sheet", "Raw log", "script", "key" or "hash".
 *
 * An article: {id, title, group, body}. body is a list of: a string (a paragraph), {steps: [...]} (numbered) or
 * {list: [...]} (bullets). **two stars** make bold. {contact} is replaced by the company's contact (config.js).
 */
(function (root) {
  'use strict';
  var articles = [
    { id: 'start', group: 'Getting around', title: 'What each page is for', body: [
      'The sidebar has three groups. **Production** shows what the entries add up to. **Records** is the entries themselves and what you print or take out. **Admin** is who logs, what they are asked, and your company\'s details.',
      { list: [
        '**Home**: what needs you today, then where the beans are, stage by stage.',
        '**Inventory**: every stage as a table, from fermenting to batches. Click a stage to see what is in it.',
        '**Ferments**: every ferment. Open one for its whole record.',
        '**Roasting**, **Making**, **Batches**: each stage after drying, in the order the cocoa moves.',
        '**Season**: one season from wet beans to batches, with the yield of each step, charts and farms.',
        '**Entries**: everything logged in the app. Fix or remove an entry here.',
        '**Labels**: print labels with a code that opens the batch history.',
        '**Exports**: the QuickBooks file, the Season report, a copy of everything, and paper forms.',
        '**People**: who logs and who signs in. **Questions**: what the field app asks. **Answer choices**: the options in its lists. **Settings**: your company\'s details.',
        '**Change log**: who changed people, answer choices and settings.',
      ] },
    ] },
    { id: 'figures', group: 'Getting around', title: 'Where the figures come from', body: [
      'No figure is typed in or stored. Each one is added up from the entries every time a page opens, so the pages always agree with what was logged.',
      'If a figure looks wrong, an entry is wrong. Find it on **Entries** and fix it there: every page then shows the new figure.',
      'Weights are in lbs. Yield is dry weight ÷ wet weight, for finished ferments. **Bagged** counts what is left to roast: the weight bagged, less what has gone into the roaster.',
    ] },
    { id: 'season', group: 'Getting around', title: 'Looking at one ferment on Season', body: [
      { steps: [
        'Open **Season** and click a bar in "Yield by ferment" (or use the arrow keys and Enter).',
        'The page stays where it is. The other charts put that ferment in colour, Compare ferments marks the groups it is in, and By farm shows only its deliveries.',
        'Press **Open ferment** for its full record, or **Whole season** (or Esc) to go back.',
      ] },
      'The figures at the top stay the season\'s: they are what the ferment is measured against.',
    ] },
    { id: 'fixing', group: 'Records', title: 'Fixing or removing an entry', body: [
      { steps: [
        'Open **Entries** and find the entry (search by ferment, person or farm).',
        'Open it. It shows what was filled in. Press **Edit**, change the box, then **Save changes**.',
        'Check the list of changes and press **Yes, save**.',
      ] },
      'A fix is saved at once. The entry keeps a note of who made it, when, and the old value, so nothing is lost by a fix.',
      'To remove a test or a mistake, press **Remove this entry…**. The page lists exactly what will go before you confirm, and a word-for-word copy is kept.',
      'IDs and calculated columns cannot be changed here.',
    ] },
    { id: 'quickbooks', group: 'Records', title: 'Export for QuickBooks, step by step', body: [
      'The export makes a file of bills for QuickBooks Online: one bill for each delivery that has a "Paid to" name, an amount and a date.',
      { steps: [
        'Open **Exports** and unfold **Export for QuickBooks**. With no dates picked it shows every delivery not exported yet.',
        'Look under the bills for **paid deliveries left out until fixed**. Press **Fix**, then **Edit**, fill in what is missing and confirm. The delivery moves into the bills.',
        'Press **Download file**. Each delivery in it is marked as exported, so the next file leaves it out.',
        'In QuickBooks: Settings → Import data → Bills, and choose the file. Tick "Add new suppliers that don\'t already exist".',
      ] },
      'Deliveries with nobody paid are your own beans. They are counted, never billed.',
      'A delivery always keeps its bill number. If you change one after exporting it, the page warns you: change that bill in QuickBooks too.',
      'The expense account, tax code, date format and bill number prefix are set on **Settings → QuickBooks export**.',
      '**Currency.** If QuickBooks uses one currency, the file has no Currency column and every bill is in that currency. If QuickBooks has several currencies switched on, choose "QuickBooks uses several currencies" and pick the one currency your bean payments are recorded in: the file then says so on every bill. It is always one code, however many currencies QuickBooks holds.',
      'The file never sets an exchange rate. With several currencies, QuickBooks applies its own rate for each bill\'s date; check it there if the rate matters.',
    ] },
    { id: 'exports', group: 'Records', title: 'Season report, a full copy, paper forms', body: [
      { list: [
        '**Season report**: a summary to print or save as a PDF, with a page for each farm. It shows prices and payments, so keep the PDF private.',
        '**Export everything**: every record in one file, prices and payments included. Sign in with your own email and password to use it.',
        '**Paper forms**: the same questions as the app, to print for a day without phones. Type them in later with the real date.',
      ] },
    ] },
    { id: 'labels', group: 'Records', title: 'Labels and printing', body: [
      { steps: [
        'Open **Labels**, choose what to print (bags of one ferment, or packages) and how many.',
        'Choose the label size: Letter paper with 6 or 10 labels, or a 4 × 6 in label printer. The picture on screen is the printed size.',
        'Press **Print**. In the print window turn off "fit to page" so the labels keep their size.',
      ] },
      'Each label has ruled lines to write on: the dry weight on a bag, and notes.',
      'The code opens that batch\'s history on any phone connected to your company: farms, fermentation, drying, roasting and packing. Never prices.',
      'On an iPhone, open your link once in Safari too: the home-screen app keeps its own storage.',
    ] },
    { id: 'people', group: 'Admin', title: 'Adding people and what they may do', body: [
      { steps: [
        'Open **People** and press **Invite person**.',
        'Type their name, and their email if they have one.',
        'Tick what they do: **Fermentation**, **Roasting**, **Making**. Their phone shows only those forms.',
        'Under **Send the link by**, pick **WhatsApp**, **QR code**, **Copy link** or **Email** (Email needs their address), then press the button. WhatsApp opens on your phone or computer with the message written; you pick the person and send. The link is shown once. An admin\'s invite is always emailed.',
      ] },
      { list: [
        '**Admin**: can open these pages, fix entries and change set-up. An admin signs in with an email and password, so an email is needed.',
        '**Can see prices and payments**: without this tick a person never sees a price, a payment or who was paid, anywhere.',
      ] },
      'To change someone later, press **⋯** on their row, then **Edit**. To stop someone, **⋯** → **Switch off…**: their phone keeps anything it has not sent.',
    ] },
    { id: 'links', group: 'Admin', title: 'Links, devices and lost phones', body: [
      'Each person has their own link, and entries are saved under their name. One link connects one device.',
      { list: [
        '**Another device**: a person can add up to five (a phone, a tablet, a laptop) from **Settings → Your devices** on a device that already works.',
        '**A lost link**: it cannot be looked up. Press **⋯** on the person, then **Send a new link**.',
        '**A lost phone**: open the person and switch that one device off. Their other devices keep working.',
        '**A link that ran out**: their phone offers "Ask for a new invite". You get an email and a line under Needs attention on Home.',
      ] },
      'Admins sign in on any computer with their email and password. **Forgot password?** on the sign-in page emails a new link.',
    ] },
    { id: 'tablets', group: 'Admin', title: 'Shared tablets and PINs', body: [
      'A shared tablet is one that several people take turns on, such as the one in the factory.',
      { steps: [
        'On **People → Shared devices**, press **Add a shared device**: its name, which areas it is for, and when a turn ends.',
        'Open the link it shows on the tablet. It works once, for 24 hours.',
        'Each person chooses a PIN on their own phone: **Settings → PIN for shared tablets**. Someone with no phone gets a **first-time code** from the person\'s panel on People.',
      ] },
      'The tablet opens on "Who\'s using this?". A turn ends when the person taps Switch, after 10 minutes with no tap, and at midnight. Nothing is lost when a turn ends, and each entry is saved under the person who made it.',
      'After three wrong PINs there is a short wait, for that person on that tablet only. **Reset PIN** on People stops a PIN everywhere. You never see anyone\'s PIN.',
      'Give the tablet a screen lock. If it is lost, press **Switch off** and **Forget PIN checks on this tablet**.',
    ] },
    { id: 'branding', group: 'Admin', title: 'Your name and logo', body: [
      'Your company\'s name and logo show in the admin site, in the field app, on the sign-in card, in emails and on labels. Change them on **Settings**.',
      '**Support contact** is the person the field app tells workers to ask ("Ask …"). Pick someone from People, or type a name. Phones show the name only.',
      'Any picture works as a logo: it is cropped to a square from the middle, and you see the result before you save.',
      'The icon on a phone\'s home screen stays the Batchstory icon. A phone picks up a new name or logo the next time it refreshes.',
    ] },
    { id: 'phones-update', group: 'Admin', title: 'How changes reach phones', body: [
      'A change to a question, an answer choice or your company\'s details reaches each phone the next time it sends, or within about 10 minutes when it has a connection.',
      '**Send and refresh now** in a phone\'s Settings does it at once.',
      'Taking an option off a list only stops it being offered: entries that already use it keep it. Switching a question off never changes entries already saved.',
      'Every change is noted in the **Change log**.',
    ] },
    { id: 'track', group: 'Admin', title: 'Questions and answer choices', body: [
      '**Questions** lists everything the field app can ask. Switch off the ones you do not record and they leave every phone, the paper forms and these pages.',
      'A whole work area (Fermentation, Roasting, Making) can be switched off too. At least one stays on.',
      '**Answer choices** holds the options for questions that have a list, such as farms and ferment plans. Add an option when a new farm delivers; take one off when it no longer applies.',
      'Questions that the stock figures, IDs or the links between stages need are always asked, and say so.',
    ] },
    { id: 'batchstory', group: 'Batchstory', title: 'Things Batchstory changes for you', body: [
      'Some things are part of how your records are built, so they are not on these pages. Ask and we will change them with you:',
      { list: [
        '**Units**: the weight unit and the temperature scales. Settings → About shows the ones you use.',
        '**A new question** on a form, or a new list of answer choices.',
        '**A new area or stage** of the work, beyond renaming the three you have.',
        '**Label sizes** other than the three offered.',
        '**The currency** your prices are in.',
      ] },
      { contact: true },
    ] },
  ];

  var field = [
    { id: 'f-sending', title: 'Sending your entries', body: [
      'When you save an entry it is kept on this phone and sent by itself as soon as there is a connection.',
      'The badge at the top says **All sent**, or how many are **waiting**. Tap it to try sending now.',
      'An entry stays on this phone until it has arrived safely. Nothing is lost by closing the app.',
    ] },
    { id: 'f-offline', title: 'With no connection', body: [
      'Everything works with no connection: open a form, fill it in and save. The entry waits on this phone.',
      'Next time you have wifi or signal, open the app and it sends what is waiting.',
    ] },
    { id: 'f-wrong', title: 'Something wrong in an entry', body: [
      'Open **My entries** and tap the entry to see what was saved.',
      'An entry that has been sent cannot be changed on this phone. Ask {contact} to fix it.',
    ] },
    { id: 'f-devices', title: 'Your devices', body: [
      'You can use up to five devices: a phone, a tablet, a laptop.',
      'To add one, open **Settings → Your devices → Add another device** on a device that already works, and point the new device\'s camera at the code.',
      'Lost a phone? On another of your devices choose **Not mine any more** beside it, or ask {contact}.',
    ] },
    { id: 'f-pin', title: 'PIN for shared tablets', body: [
      'A shared tablet asks who is using it. Tap your name and type your PIN.',
      'Choose your PIN here, in **Settings → PIN for shared tablets**. Keep it to yourself.',
      'Tap **Switch** at the top of the tablet when you are done. Anything you saved is sent under your name.',
      'Forgot your PIN, or the tablet makes you wait? Ask {contact}.',
    ] },
    { id: 'f-laptop', title: 'On a laptop', body: [
      'On a wide screen with a mouse, the forms list stays beside the form you are filling in, and My entries is a table you can sort.',
      '**Ctrl+Enter** saves (**⌘+Enter** on a Mac). **Save and start another** saves and opens the same form again, empty. Enter moves to the next box.',
      'To choose, open **Settings → Screen layout**: Automatic, Phone or Laptop. It is kept for this device only.',
    ] },
  ];

  /** One article's body as page nodes. mk(tag, className, text) makes an element; o: {contact}. */
  function body(article, mk, o) {
    o = o || {};
    function rich(node, text) {
      String(text).replace(/\{contact\}/g, function () { return o.contact || 'your admin'; }).split('**').forEach(function (part, i) {
        if (!part) return;
        if (i % 2) node.appendChild(mk('b', '', part)); else node.appendChild(node.ownerDocument.createTextNode(part));
      });
      return node;
    }
    return article.body.map(function (b) {
      if (typeof b === 'string') return rich(mk('p', '', ''), b);
      if (b.contact) { // help.js turns this into a "Contact Batchstory" link when the company has been given an address; none is kept in these files
        var p = mk('p', 'help-contact', 'Ask your Batchstory contact.'); p.id = 'help-contact';
        return p;
      }
      var list = mk(b.steps ? 'ol' : 'ul', '', '');
      (b.steps || b.list).forEach(function (t) { list.appendChild(rich(mk('li', '', ''), t)); });
      return list;
    });
  }

  var api = { articles: articles, field: field, body: body };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CH_HELP = api;
})(typeof window !== 'undefined' ? window : this);
