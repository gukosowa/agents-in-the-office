import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { CharacterDefinition } from '../types/character';

export const useCharacterStore = defineStore('character', () => {
  const characters = ref<CharacterDefinition[]>([]);
  const dirtyVersion = ref(0);

  function addCharacter(def: CharacterDefinition): void {
    characters.value.push(def);
    dirtyVersion.value++;
  }

  function updateCharacter(
    id: string,
    patch: Partial<CharacterDefinition>,
  ): void {
    const existing = characters.value.find((c) => c.id === id);
    if (!existing) return;
    Object.assign(existing, patch);
    dirtyVersion.value++;
  }

  function removeCharacter(id: string): void {
    const index = characters.value.findIndex((c) => c.id === id);
    if (index === -1) return;
    characters.value.splice(index, 1);
    dirtyVersion.value++;
  }

  function getCharacter(id: string): CharacterDefinition | undefined {
    return characters.value.find((c) => c.id === id);
  }

  function setCharacters(defs: CharacterDefinition[]): void {
    characters.value = defs;
    dirtyVersion.value = 0;
  }

  return {
    characters,
    dirtyVersion,
    addCharacter,
    updateCharacter,
    removeCharacter,
    getCharacter,
    setCharacters,
  };
});
