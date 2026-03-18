/**
 * Tests for the NotificationService.
 *
 * Verifies that the service posts formatted activity comments
 * via HostServices, respects notification preferences, and
 * handles createComment errors gracefully.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostServices } from '../agents/types.js';
import type { PipelineNotificationEvent } from './formatters.js';
import { NotificationService } from './notification-service.js';

/** Create a mock HostServices with a spy on issues.createComment. */
function createMockServices(): HostServices {
  return {
    agents: {
      invoke: vi.fn(),
    },
    issues: {
      create: vi.fn(),
      createComment: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
      listComments: vi.fn(),
    },
  };
}

describe('NotificationService', () => {
  let services: HostServices;
  let service: NotificationService;
  const companyId = 'company-1';
  const statusIssueId = 'issue-42';

  beforeEach(() => {
    services = createMockServices();
    service = new NotificationService(services, companyId, statusIssueId);
  });

  it('calls createComment with formatted message for phase_completed', async () => {
    const event: PipelineNotificationEvent = {
      type: 'phase_completed',
      phaseNumber: 2,
      phaseName: 'State Machines',
    };
    await service.notify(event);

    expect(services.issues.createComment).toHaveBeenCalledOnce();
    expect(services.issues.createComment).toHaveBeenCalledWith({
      companyId,
      issueId: statusIssueId,
      body: expect.stringContaining('Phase 2'),
    });
  });

  it('does NOT call createComment when preference blocks event', async () => {
    service.setPreference('failures_only');
    const event: PipelineNotificationEvent = {
      type: 'phase_completed',
      phaseNumber: 2,
      phaseName: 'State Machines',
    };
    await service.notify(event);

    expect(services.issues.createComment).not.toHaveBeenCalled();
  });

  it('calls createComment for escalation events', async () => {
    const event: PipelineNotificationEvent = {
      type: 'escalation',
      phaseNumber: 4,
      context: 'Quality gate failed',
      options: ['Retry', 'Skip', 'Abort'],
    };
    await service.notify(event);

    expect(services.issues.createComment).toHaveBeenCalledOnce();
    expect(services.issues.createComment).toHaveBeenCalledWith({
      companyId,
      issueId: statusIssueId,
      body: expect.stringContaining('Quality gate failed'),
    });
  });

  it('calls createComment for pipeline_started events', async () => {
    const event: PipelineNotificationEvent = {
      type: 'pipeline_started',
      projectPath: '/home/user/project',
      brief: 'Build something',
    };
    await service.notify(event);

    expect(services.issues.createComment).toHaveBeenCalledOnce();
    expect(services.issues.createComment).toHaveBeenCalledWith({
      companyId,
      issueId: statusIssueId,
      body: expect.stringContaining('/home/user/project'),
    });
  });

  it('handles createComment errors gracefully (does not throw)', async () => {
    vi.mocked(services.issues.createComment).mockRejectedValueOnce(
      new Error('Network error'),
    );

    const event: PipelineNotificationEvent = {
      type: 'phase_completed',
      phaseNumber: 1,
      phaseName: 'Foundation',
    };

    // Should not throw
    await expect(service.notify(event)).resolves.toBeUndefined();
  });

  it('setPreference changes filtering behavior', async () => {
    // Default is 'all' -- should notify
    const event: PipelineNotificationEvent = {
      type: 'phase_completed',
      phaseNumber: 1,
      phaseName: 'Foundation',
    };
    await service.notify(event);
    expect(services.issues.createComment).toHaveBeenCalledOnce();

    vi.mocked(services.issues.createComment).mockClear();

    // Switch to escalations_only -- should NOT notify for phase_completed
    service.setPreference('escalations_only');
    await service.notify(event);
    expect(services.issues.createComment).not.toHaveBeenCalled();
  });

  it('getPreference returns current preference', () => {
    expect(service.getPreference()).toBe('all');
    service.setPreference('failures_only');
    expect(service.getPreference()).toBe('failures_only');
  });
});
