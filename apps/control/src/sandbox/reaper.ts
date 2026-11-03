import type Docker from 'dockerode';

/** Removes every leftover sandbox container (label earshot.sandbox=1). Called at control boot. */
export async function reapOrphans(docker: Docker): Promise<number> {
  const list = await docker.listContainers({ all: true, filters: { label: ['earshot.sandbox=1'] } });
  let n = 0;
  for (const c of list) {
    try {
      await docker.getContainer(c.Id).remove({ force: true });
      n++;
    } catch (e) {
      if ((e as { statusCode?: number }).statusCode === 404) n++;
    }
  }
  return n;
}
