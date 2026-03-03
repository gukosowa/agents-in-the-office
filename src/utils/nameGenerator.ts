const ADJECTIVES = [
  'Brave', 'Dizzy', 'Sneaky', 'Fluffy', 'Grumpy',
  'Jolly', 'Sleepy', 'Witty', 'Clumsy', 'Fancy',
  'Hasty', 'Lucky', 'Moody', 'Nerdy', 'Peppy',
  'Quirky', 'Rusty', 'Sassy', 'Tiny', 'Wacky',
  'Zany', 'Breezy', 'Crispy', 'Dapper', 'Eager',
  'Fizzy', 'Giddy', 'Humble', 'Icy', 'Jazzy',
  'Keen', 'Lanky', 'Merry', 'Nutty', 'Odd',
  'Plucky', 'Rowdy', 'Sunny', 'Toasty', 'Vivid',
] as const;

const NOUNS = [
  'Penguin', 'Mango', 'Waffle', 'Cactus', 'Noodle',
  'Panda', 'Taco', 'Pickle', 'Donut', 'Walrus',
  'Badger', 'Pretzel', 'Otter', 'Muffin', 'Gecko',
  'Turnip', 'Parrot', 'Biscuit', 'Squid', 'Potato',
  'Ferret', 'Crouton', 'Falcon', 'Pudding', 'Iguana',
  'Bagel', 'Lobster', 'Cupcake', 'Yak', 'Truffle',
  'Alpaca', 'Dumpling', 'Newt', 'Cookie', 'Quail',
  'Radish', 'Sloth', 'Strudel', 'Toucan', 'Wombat',
] as const;

const MAX_ATTEMPTS = 100;

export function generateFunnyName(
  existingNames: Set<string>,
): string {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const adj = ADJECTIVES[
      Math.floor(Math.random() * ADJECTIVES.length)
    ];
    const noun = NOUNS[
      Math.floor(Math.random() * NOUNS.length)
    ];
    const name = `${adj} ${noun}`;
    if (!existingNames.has(name)) return name;
  }

  const adj = ADJECTIVES[
    Math.floor(Math.random() * ADJECTIVES.length)
  ];
  const noun = NOUNS[
    Math.floor(Math.random() * NOUNS.length)
  ];
  let suffix = 2;
  let name = `${adj} ${noun} ${suffix}`;
  while (existingNames.has(name)) {
    suffix++;
    name = `${adj} ${noun} ${suffix}`;
  }
  return name;
}
