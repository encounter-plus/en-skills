/** Fixed synthetic host command. Data is passed separately from executable code. */
export async function applyRuntimeUpdate(update) {
  const names={task:'updateTask',messages:'updateMessages',hints:'updateHints',bonuses:'updateBonuses',sectors:'updateSectors'};
  const method=names[update.section];
  if(!method||typeof window.__enplus?.[method]!=='function')throw new Error('RN update method unavailable');
  await window.__enplus[method](update.data);
}
