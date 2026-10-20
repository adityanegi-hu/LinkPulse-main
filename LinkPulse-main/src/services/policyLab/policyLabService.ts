import { evaluateRedirectRules } from '../../lib/utils';
import { linkService } from '../links/linkService';
import { trustService } from '../trust/trustService';
import { httpClient } from '../../lib/api/httpClient';

export const policyLabService = {
  async simulate(payload: {
    linkId?: string;
    hypotheticalLink?: any;
    device?: string;
    country?: string;
    simulatedTime?: string;
    providedPassword?: string;
    simulatedClicksCount?: number;
    simulatedIsActive?: boolean;
  }): Promise<any> {
    try {
      const data = await httpClient.post<any>('/policy-lab/simulate', payload);
      if (data?.evaluation) {
        return {
          status: data.evaluation.status,
          message: data.evaluation.reason || (data.evaluation.status === 'success' ? 'Redirect permitted' : 'Redirect halted or challenged'),
          targetUrl: data.evaluation.destinationUrl,
          evaluation: {
            ...data.evaluation,
            trace: data.evaluation.trace || [],
          },
          timestamp: new Date().toISOString(),
        };
      }
    } catch {
      // Fallback to local simulator
    }

    let link = payload.hypotheticalLink;
    if (!link && payload.linkId) {
      try {
        link = await linkService.getLink(payload.linkId);
      } catch {}
    }

    if (!link) {
      link = {
        id: 'hypothetical',
        userId: 'current',
        originalUrl: 'https://example.com/target',
        shortCode: 'sim',
        title: 'Simulated Link',
        domain: 'linkpulse.io',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isActive: payload.simulatedIsActive !== false,
        clicksCount: payload.simulatedClicksCount || 0,
        uniqueClicksCount: 0,
        qrScansCount: 0,
        tags: [],
        rules: {},
      };
    }

    // Apply simulation overrides
    const testLink = {
      ...link,
      isActive: payload.simulatedIsActive !== undefined ? payload.simulatedIsActive : link.isActive,
      clicksCount: payload.simulatedClicksCount !== undefined ? payload.simulatedClicksCount : link.clicksCount,
      rules: {
        ...link.rules,
        expiresAt: payload.simulatedTime || link.rules?.expiresAt,
      },
    };

    const blocklist = await trustService.getBlocklist();
    const domainList = blocklist.map((b) => b.domain);

    const result = evaluateRedirectRules(testLink, {
      passwordEntered: payload.providedPassword,
      blocklist: domainList,
    });

    return {
      status: result.status,
      message: 'message' in result ? result.message : 'Redirect successful',
      targetUrl: 'destinationUrl' in result ? result.destinationUrl : testLink.originalUrl,
      evaluation: result,
      timestamp: new Date().toISOString(),
    };
  },
};
