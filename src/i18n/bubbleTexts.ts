import type { Locale } from '../stores/localeStore';

type TextMap = Record<string, string[]>;
type LocaleTextMap = Record<Locale, TextMap>;

export const WALKING_THOUGHTS: LocaleTextMap = {
  en: {
    coffee: [
      'Need coffee...', 'Coffee time!', 'Caffeine break...',
      'Espresso sounds good.', 'Time for a latte.',
      'My cup is empty...', 'Gotta refuel.',
      'A flat white, maybe?', 'Coffee run!',
      'Can\'t focus without it.', 'Smells good already.',
    ],
    computer: [
      'Work to do...', 'Check emails...', 'Time to code.',
      'Gotta fix that bug.', 'PR reviews waiting.',
      'Let me check Slack.', 'Deploy time.',
      'Where was that ticket?', 'Back to the screen.',
      'Need to push that commit.', 'Stand-up notes...',
    ],
    books: [
      'Time to read.', 'Need a book...', 'Study time.',
      'That chapter was good.', 'Where did I leave off?',
      'Gotta look this up.', 'Research time.',
      'The docs say what now?', 'Page 42, I think.',
      'Need the reference manual.', 'Learning something new.',
    ],
    plant: [
      'Nice plant.', 'Water the plant?', 'Green is good.',
      'Looking a bit dry.', 'Love that fern.',
      'Time to water.', 'Nature break.',
      'Such pretty leaves.', 'Needs more sunlight.',
      'Growing nicely!', 'My green friend.',
    ],
    chair: [
      'Time to sit.', 'Need a break.', 'Gonna rest.',
      'My back hurts.', 'Just five minutes.',
      'Feet are tired.', 'Quick sit-down.',
      'That chair looks comfy.', 'Rest time.',
      'Standing is overrated.', 'Need to recharge.',
    ],
    desk: [
      'Back to work.', 'My desk awaits.', 'Papers to sort.',
      'Where\'s my pen?', 'Desk is messy again.',
      'Need to organize.', 'Files everywhere.',
    ],
    _default: [
      'Going there.', 'On my way...', 'Let me see...',
      'Heading over.', 'Just a moment.',
      'Almost there.', 'Walking, walking...',
      'Off I go.', 'One step at a time.',
      'Be right there.', 'Coming through.',
    ],
  },
  de: {
    coffee: [
      'Brauch Kaffee...', 'Kaffeepause!', 'Koffein-Nachschub...',
      'Ein Espresso wär gut.', 'Zeit für Latte.',
      'Tasse ist leer...', 'Muss nachtanken.',
      'Vielleicht ein Cappuccino?', 'Kaffee holen!',
      'Ohne geht nix.', 'Riecht schon gut.',
    ],
    computer: [
      'Arbeit wartet...', 'Mails checken...', 'Zeit zum Coden.',
      'Muss den Bug fixen.', 'PR-Reviews warten.',
      'Mal Slack checken.', 'Deployment-Zeit.',
      'Wo war das Ticket?', 'Zurück zum Bildschirm.',
      'Muss den Commit pushen.', 'Stand-up Notizen...',
    ],
    books: [
      'Zeit zum Lesen.', 'Brauch ein Buch...', 'Lernzeit.',
      'Das Kapitel war gut.', 'Wo war ich stehengeblieben?',
      'Muss das nachschlagen.', 'Recherche-Zeit.',
      'Was steht in der Doku?', 'Seite 42, glaub ich.',
      'Brauch das Handbuch.', 'Was Neues lernen.',
    ],
    plant: [
      'Schöne Pflanze.', 'Gießen?', 'Grün ist gut.',
      'Sieht etwas trocken aus.', 'Mag den Farn.',
      'Zeit zum Gießen.', 'Natur-Pause.',
      'Hübsche Blätter.', 'Braucht mehr Sonne.',
      'Wächst gut!', 'Mein grüner Freund.',
    ],
    chair: [
      'Zeit zum Sitzen.', 'Brauch ne Pause.', 'Mal ausruhen.',
      'Mein Rücken...', 'Nur fünf Minuten.',
      'Füße tun weh.', 'Kurz hinsetzen.',
      'Der Stuhl sieht bequem aus.', 'Pausenzeit.',
      'Stehen ist überbewertet.', 'Muss Energie tanken.',
    ],
    desk: [
      'Zurück an die Arbeit.', 'Mein Schreibtisch wartet.',
      'Papiere sortieren.', 'Wo ist mein Stift?',
      'Schreibtisch schon wieder voll.', 'Muss aufräumen.',
      'Überall Akten.',
    ],
    _default: [
      'Bin unterwegs.', 'Komme gleich...', 'Mal schauen...',
      'Geh mal rüber.', 'Moment noch.',
      'Fast da.', 'Laufe, laufe...',
      'Los geht\'s.', 'Schritt für Schritt.',
      'Bin gleich da.', 'Komme durch.',
    ],
  },
};

export const ARRIVAL_SPEECH: LocaleTextMap = {
  en: {
    coffee: [
      'Ah, good coffee!', 'Just what I needed.',
      'Mmm, warm.', 'Perfect brew.',
      'Nothing beats fresh coffee.', 'Ahhh, that\'s the stuff.',
      'Best part of the day.', 'Liquid motivation!',
      'Strong and hot.', 'My favorite blend.',
      'This makes everything better.',
    ],
    computer: [
      'Let me check this.', 'Typing away...',
      'Emails, emails...', 'Oh, new notifications.',
      'Let\'s see the code.', 'Compiling...',
      'Inbox zero? Never.', 'Tests are green!',
      'Time to ship it.', 'Debugging mode ON.',
      'Stack trace again?!',
    ],
    books: [
      'Interesting read!', 'Good chapter.',
      'Knowledge is power.', 'Fascinating stuff.',
      'This explains a lot.', 'Page-turner!',
      'I learned something.', 'Great reference.',
      'The plot thickens.', 'Note to self...',
      'Ah, here it is!',
    ],
    plant: [
      'Looking healthy!', 'Pretty leaves.',
      'Nature is nice.', 'Growing well!',
      'Hello little plant.', 'Fresh and green.',
      'That\'s better now.', 'Photosynthesis!',
      'Lovely colors.', 'Stay hydrated, buddy.',
      'You brighten my day.',
    ],
    chair: [
      'Ah, comfy.', 'Nice to sit.', 'Taking a load off.',
      'My legs thank me.', 'Perfect spot.',
      'Could sit here all day.', 'So comfortable.',
      'Needed this.', 'Relaxation mode.',
      'Five more minutes...', 'Bliss.',
    ],
    desk: [
      'Let\'s get organized.', 'My workspace.',
      'Where was that note?', 'Everything in order.',
      'Desk sweet desk.', 'Time to focus.',
      'Papers, papers...', 'Got my pen.',
    ],
    _default: [
      'Here we are.', 'Made it!', 'Alright then.',
      'And... arrived.', 'That was a walk.',
      'Here I am.', 'Ta-da!',
      'Destination reached.', 'Finally.',
      'Mission accomplished.', 'There we go.',
    ],
  },
  de: {
    coffee: [
      'Ah, guter Kaffee!', 'Genau was ich brauchte.',
      'Mmm, warm.', 'Perfekt gebrüht.',
      'Nichts geht über frischen Kaffee.', 'Ahhh, das ist es.',
      'Bester Teil des Tages.', 'Flüssige Motivation!',
      'Stark und heiß.', 'Meine Lieblingsmischung.',
      'Das macht alles besser.',
    ],
    computer: [
      'Mal gucken hier.', 'Tippe los...',
      'Mails, Mails...', 'Oh, neue Benachrichtigungen.',
      'Schauen wir uns den Code an.', 'Kompiliert...',
      'Inbox Zero? Nie.', 'Tests sind grün!',
      'Zeit zum Ausliefern.', 'Debug-Modus AN.',
      'Schon wieder ein Stack Trace?!',
    ],
    books: [
      'Spannende Lektüre!', 'Gutes Kapitel.',
      'Wissen ist Macht.', 'Faszinierender Stoff.',
      'Das erklärt einiges.', 'Seitenumblätterer!',
      'Was gelernt.', 'Tolle Referenz.',
      'Es wird spannend.', 'Notiz an mich...',
      'Ah, da steht es!',
    ],
    plant: [
      'Sieht gesund aus!', 'Hübsche Blätter.',
      'Natur ist schön.', 'Wächst gut!',
      'Hallo kleine Pflanze.', 'Frisch und grün.',
      'So ist es besser.', 'Photosynthese!',
      'Schöne Farben.', 'Bleib hydriert, Kumpel.',
      'Du machst meinen Tag.',
    ],
    chair: [
      'Ah, bequem.', 'Schön zu sitzen.', 'Entlastung.',
      'Meine Beine danken mir.', 'Perfekter Platz.',
      'Könnte hier den ganzen Tag sitzen.', 'So gemütlich.',
      'Das brauchte ich.', 'Entspannungsmodus.',
      'Noch fünf Minuten...', 'Herrlich.',
    ],
    desk: [
      'Mal Ordnung schaffen.', 'Mein Arbeitsplatz.',
      'Wo war die Notiz?', 'Alles in Ordnung.',
      'Schreibtisch, süßes Zuhause.', 'Zeit zum Fokussieren.',
      'Papiere, Papiere...', 'Hab meinen Stift.',
    ],
    _default: [
      'Da wären wir.', 'Geschafft!', 'Na dann.',
      'Und... angekommen.', 'Das war ein Spaziergang.',
      'Hier bin ich.', 'Ta-da!',
      'Ziel erreicht.', 'Endlich.',
      'Mission erledigt.', 'So, bitte.',
    ],
  },
};

export const WANDER_THOUGHTS: Record<Locale, string[]> = {
  en: [
    'Just stretching...', 'Going for a walk.',
    'Hmm, where to go?', 'Need some air.',
    'Taking a stroll.', 'Exploring...',
    'La la la...', 'Nice office.',
    'Wonder what\'s over there.', 'Leg day every day.',
    'Thinking things over.', 'Just wandering.',
    'Fresh legs, fresh mind.', 'Anyone seen my mug?',
    'Where was I going?', 'Ah, the scenic route.',
    'Step step step.', 'Good vibes today.',
    'Nothing urgent.', 'Taking the long way.',
  ],
  de: [
    'Mal strecken...', 'Ein Spaziergang.',
    'Hmm, wohin?', 'Brauch frische Luft.',
    'Bisschen rumlaufen.', 'Erkunden...',
    'La la la...', 'Schönes Büro.',
    'Was ist da drüben?', 'Jeden Tag Beintag.',
    'Nachdenken...', 'Einfach rumlaufen.',
    'Frische Beine, frischer Kopf.', 'Hat jemand meine Tasse gesehen?',
    'Wo wollte ich hin?', 'Ah, die Panorama-Route.',
    'Schritt, Schritt, Schritt.', 'Gute Stimmung heute.',
    'Nichts Dringendes.', 'Den langen Weg nehmen.',
  ],
};

export function getWalkingThoughts(
  locale: Locale,
  objectType: string,
): string[] {
  const map = WALKING_THOUGHTS[locale];
  return map[objectType] ?? map['_default']!;
}

export function getArrivalSpeech(
  locale: Locale,
  objectType: string,
): string[] {
  const map = ARRIVAL_SPEECH[locale];
  return map[objectType] ?? map['_default']!;
}

export const LEAVING_THOUGHTS: Record<Locale, string[]> = {
  en: [
    'Time to go.', 'Heading out!', 'See you later.',
    'Gotta run.', 'Done for now.', 'Off I go!',
    'Bye bye!', 'That\'s my cue.', 'Wrapping up.',
    'Until next time.', 'Out the door!',
  ],
  de: [
    'Zeit zu gehen.', 'Bin dann weg!', 'Bis später.',
    'Muss los.', 'Fertig für heute.', 'Und tschüss!',
    'Bye bye!', 'Das war\'s.', 'Feierabend.',
    'Bis zum nächsten Mal.', 'Ab durch die Tür!',
  ],
};

export function getWanderThoughts(locale: Locale): string[] {
  return WANDER_THOUGHTS[locale];
}

export function getLeavingThoughts(locale: Locale): string[] {
  return LEAVING_THOUGHTS[locale];
}

const IDLE_CONVERSATIONS: Record<Locale, string[][]> = {
  en: [
    [
      'Did you deploy on Friday?',
      "We don't talk about that.",
      'That bad?',
      'The on-call guy cried.',
    ],
    [
      'Coffee machine is broken.',
      'This is a crisis.',
      'I know, right?',
      'Cancel all meetings.',
    ],
    [
      'My code worked locally.',
      'Famous last words.',
      'But it really did!',
      "Sure it did.",
    ],
    [
      'How many tabs do you have open?',
      "I'm afraid to count.",
      'More than fifty?',
      "Let's change the subject.",
    ],
    [
      'Stand-up took an hour.',
      'Was it even standing?',
      'People brought chairs.',
      'That says it all.',
    ],
    [
      "Have you seen the new Jira board?",
      "We have a new one?",
      'They reorganized again.',
      'Third time this month.',
    ],
    [
      'I wrote zero lines today.',
      'Productive meetings?',
      'Six of them.',
      'My condolences.',
    ],
    [
      'Git blame says this is mine.',
      'Oof.',
      'From three years ago.',
      'Past you was brave.',
    ],
  ],
  de: [
    [
      'Hast du am Freitag deployed?',
      'Davon sprechen wir nicht.',
      'So schlimm?',
      'Der Bereitschaftsdienst hat geweint.',
    ],
    [
      'Kaffeemaschine ist kaputt.',
      'Das ist eine Krise.',
      'Oder?',
      'Alle Meetings absagen.',
    ],
    [
      'Mein Code lief lokal.',
      'Berühmte letzte Worte.',
      'Aber wirklich!',
      'Klar doch.',
    ],
    [
      'Wie viele Tabs hast du offen?',
      'Ich trau mich nicht zu zählen.',
      'Mehr als fünfzig?',
      'Themenwechsel bitte.',
    ],
    [
      'Stand-up hat eine Stunde gedauert.',
      'Wurde überhaupt gestanden?',
      'Leute brachten Stühle.',
      'Das sagt alles.',
    ],
    [
      'Hast du das neue Jira-Board gesehen?',
      'Wir haben ein neues?',
      'Wieder umorganisiert.',
      'Zum dritten Mal diesen Monat.',
    ],
    [
      'Ich hab heute null Zeilen geschrieben.',
      'Produktive Meetings?',
      'Sechs Stück.',
      'Mein Beileid.',
    ],
    [
      'Git blame sagt, das war ich.',
      'Autsch.',
      'Von vor drei Jahren.',
      'Das frühere Ich war mutig.',
    ],
  ],
};

export function getIdleConversation(locale: Locale): string[] {
  const conversations = IDLE_CONVERSATIONS[locale];
  return conversations[
    Math.floor(Math.random() * conversations.length)
  ]!;
}
