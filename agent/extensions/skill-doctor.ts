// skill-doctor — validate only the repository-owned opt-in registry; never scan personal skills.
import { VERSION as PI_VERSION } from '@earendil-works/pi-coding-agent';
import { inspectSkills, inspectSkillDiscovery, skillValidationLabel } from '../neura/skills-registry.mjs';

export default function (pi) {
  if (!process.env.NEURA) return; // plain Pi stays stock

  const inspect = (allowMissing = false) => inspectSkillDiscovery(
    inspectSkills({ piVersion: PI_VERSION, availableTools: pi.getAllTools().map(tool => tool.name) }),
    pi.getCommands(), { allowMissing },
  );
  pi.on('resources_discover', (_event, ctx) => {
    // Discovery runs before our paths are appended; existing reserved winners
    // must already have the exact selected identity. Missing paths are checked
    // after loading by doctor/health rather than attested from selection alone.
    const report = inspect(true);
    if (!report.valid) ctx.ui.notify(`${skillValidationLabel(report)}; supported skills disabled. ${report.errors.join('; ')}`, 'warning');
    return { skillPaths: report.skillPaths };
  });
  pi.registerCommand('skill-doctor', {
    description: 'Read-only validation of the exact supported skill manifest and opt-in selection',
    handler: async (_args, ctx) => {
      const report = inspect();
      ctx.ui.notify(`${skillValidationLabel(report)}${report.valid ? ` · ${report.enabled.join(', ') || 'all optional skills disabled'}` : ` · ${report.errors.join('; ')}`}`, report.valid ? 'info' : 'warning');
    },
  });
}
