import type { Discipline, EligibilityResult, MemberRankState, Promotion } from '@obikai/domain';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithSubject } from '../test/render';
import { MyProgressPage } from './MyProgressPage';

vi.mock('../api/member-data', () => ({
  getMe: vi.fn().mockResolvedValue({ userId: 'u1', memberId: 'm1', roles: [] }),
  getDependents: vi.fn().mockResolvedValue([]),
  myRankStates: vi.fn().mockResolvedValue([{ id: 'rs1', disciplineId: 'd1' } as MemberRankState]),
  myDisciplines: vi.fn().mockResolvedValue([{ id: 'd1', name: { en: 'BJJ' } } as Discipline]),
  myEligibility: vi.fn().mockResolvedValue({
    systemVersionId: 'v1',
    evaluatedAt: { epochMs: 0 },
    nextSteps: [
      {
        stepId: 'blue',
        status: 'close',
        unmetRequired: ['minClassesSinceLastPromotion'],
        unmetAdvisory: [],
        criteria: [
          {
            type: 'minClassesSinceLastPromotion',
            enforcement: 'required',
            satisfied: false,
            reasonKey: 'k',
            progress: {
              current: 80,
              target: 100,
              remaining: 20,
              unit: 'classes',
              fractionComplete: 0.8,
            },
          },
        ],
      },
    ],
  } as unknown as EligibilityResult),
  myPromotions: vi.fn().mockResolvedValue([
    {
      id: 'p1',
      fromStepId: null,
      toStepId: 'white',
      awardedAt: '2026-01-01T00:00:00.000Z',
    } as Promotion,
  ]),
}));

function renderPage() {
  return renderWithSubject(<MyProgressPage />);
}

describe('MyProgressPage', () => {
  it('shows the member’s discipline, next-step eligibility and history', async () => {
    renderPage();
    // Discipline name resolved from the disciplines list.
    expect(await screen.findByRole('heading', { name: 'BJJ' })).toBeInTheDocument();
    // Eligibility (its own query): "almost there" badge + per-criterion progress.
    expect(await screen.findByText(/almost there/i)).toBeInTheDocument();
    expect(screen.getByText(/Next step: blue/i)).toBeInTheDocument();
    expect(screen.getByText('80/100 classes')).toBeInTheDocument();
    // History (its own query).
    expect(await screen.findByText('white')).toBeInTheDocument();
  });
});
