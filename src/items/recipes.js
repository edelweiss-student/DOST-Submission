import { newStack } from './inventory.js';

// What can be made, and from what. For now: stone tools from sticks and stones.
export const RECIPES = [
  { makes: 'knife', needs: { stick: 1, stone: 1 } },
  { makes: 'axe', needs: { stick: 2, stone: 2 } },
  { makes: 'pickaxe', needs: { stick: 2, stone: 3 } },
];

export const canCraft = (inventory, recipe) =>
  Object.entries(recipe.needs).every(([id, n]) => inventory.count(id) >= n);

// Uses up the ingredients and returns the new item's stack, or null if
// something is missing. Adding it to the bag is up to the caller.
export function craft(inventory, recipe) {
  if (!canCraft(inventory, recipe)) return null;
  for (const [id, n] of Object.entries(recipe.needs)) inventory.remove(id, n);
  return newStack(recipe.makes);
}
