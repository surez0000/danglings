export type RitualType = "ward" | "bless" | "sparkle" | "chime";

export type Charm = {
  id: string;
  emoji: string;
  name: string;
  ritual: RitualType;
  region: string;
  description: string;
  actionLabel: string;
};

/* Animal emoji roster, labeled with the emoji's original (CLDR) name. Rituals
   cycle so neighboring animals answer a click with different sounds. */
const ANIMALS: Array<[id: string, emoji: string, name: string]> = [
  ["dog", "🐶", "Dog Face"],
  ["cat", "🐱", "Cat Face"],
  ["mouse", "🐭", "Mouse Face"],
  ["hamster", "🐹", "Hamster"],
  ["rabbit", "🐰", "Rabbit Face"],
  ["fox", "🦊", "Fox"],
  ["bear", "🐻", "Bear"],
  ["panda", "🐼", "Panda"],
  ["koala", "🐨", "Koala"],
  ["tiger", "🐯", "Tiger Face"],
  ["lion", "🦁", "Lion"],
  ["cow", "🐮", "Cow Face"],
  ["pig", "🐷", "Pig Face"],
  ["frog", "🐸", "Frog"],
  ["monkey", "🐵", "Monkey Face"],
  ["chick", "🐤", "Baby Chick"],
  ["penguin", "🐧", "Penguin"],
  ["bird", "🐦", "Bird"],
  ["owl", "🦉", "Owl"],
  ["duck", "🦆", "Duck"],
  ["unicorn", "🦄", "Unicorn"],
  ["bee", "🐝", "Honeybee"],
  ["butterfly", "🦋", "Butterfly"],
  ["ladybug", "🐞", "Lady Beetle"],
  ["turtle", "🐢", "Turtle"],
  ["octopus", "🐙", "Octopus"],
  ["whale", "🐳", "Spouting Whale"],
  ["dolphin", "🐬", "Dolphin"],
  ["sloth", "🦥", "Sloth"],
  ["flamingo", "🦩", "Flamingo"],
];

const RITUALS: RitualType[] = ["sparkle", "chime", "bless", "ward"];

export const DEFAULT_CHARMS: Charm[] = ANIMALS.map(([id, emoji, name], i) => ({
  id,
  emoji,
  name,
  ritual: RITUALS[i % RITUALS.length],
  region: "",
  description: "",
  actionLabel: "Give it a tap",
}));

export function ritualFor(charm: Charm): RitualType {
  return charm.ritual ?? "sparkle";
}
