import { createRouter, createWebHistory } from 'vue-router'
import EditorView from '../views/EditorView.vue'
import RunView from '../views/RunView.vue'
import { AITO_FILE_PATH_KEY } from '../utils/fileIO'
import { debugLogDirect } from '../utils/debugLog'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'editor',
      component: EditorView,
    },
    {
      path: '/run',
      name: 'run',
      component: RunView,
    },
  ],
})

router.beforeEach(async (to, from) => {
  await debugLogDirect('ROUTER',
    `to=${String(to.name)} from=${String(from.name)}`);
  if (to.name !== 'editor' || from.name !== undefined) {
    return true;
  }
  const filePath = localStorage.getItem(AITO_FILE_PATH_KEY);
  await debugLogDirect('ROUTER',
    `filePath=${filePath ?? 'null'} → ${filePath ? '/run' : 'editor'}`);
  if (filePath) {
    return '/run';
  }
  return true;
});

export default router
