import type { EligibilityResult } from '@obikai/domain';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EligibilityDashboard } from './EligibilityDashboard';

const ready = {
  systemVersionId: 'v1',
  evaluatedAt: { epochMs: 0 },
  nextSteps: [
    {
      stepId: 'blue',
      status: 'ready',
      unmetRequired: [],
      unmetAdvisory: [],
      criteria: [
        {
          type: 'minClassesSinceLastPromotion',
          enforcement: 'required',
          satisfied: true,
          reasonKey: 'k',
          progress: {
            current: 120,
            target: 100,
            remaining: 0,
            unit: 'classes',
            fractionComplete: 1,
          },
        },
      ],
    },
  ],
} as unknown as EligibilityResult;

const notYet = {
  systemVersionId: 'v1',
  evaluatedAt: { epochMs: 0 },
  nextSteps: [
    {
      stepId: 'blue',
      status: 'notYet',
      unmetRequired: ['minClassesSinceLastPromotion'],
      unmetAdvisory: [],
      criteria: [
        {
          type: 'minClassesSinceLastPromotion',
          enforcement: 'required',
          satisfied: false,
          reasonKey: 'k',
          progress: {
            current: 40,
            target: 100,
            remaining: 60,
            unit: 'classes',
            fractionComplete: 0.4,
          },
        },
      ],
    },
  ],
} as unknown as EligibilityResult;

describe('EligibilityDashboard', () => {
  it('awards directly when the step is ready', async () => {
    const onAward = vi.fn();
    render(<EligibilityDashboard result={ready} onAward={onAward} pending={false} />);
    expect(screen.getByText('Ready')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /award next rank/i }));
    expect(onAward).toHaveBeenCalledWith('blue');
  });

  it('requires an override reason to force-promote a not-yet step', async () => {
    const onAward = vi.fn();
    render(<EligibilityDashboard result={notYet} onAward={onAward} pending={false} />);
    const force = screen.getByRole('button', { name: /force-promote/i });
    expect(force).toBeDisabled(); // no reason yet
    await userEvent.type(screen.getByLabelText(/override reason/i), 'tournament gold');
    expect(force).toBeEnabled();
    await userEvent.click(force);
    expect(onAward).toHaveBeenCalledWith('blue', 'tournament gold');
  });

  it('shows the top-of-ladder message when there is no next step', () => {
    render(
      <EligibilityDashboard
        result={
          {
            systemVersionId: 'v1',
            evaluatedAt: { epochMs: 0 },
            nextSteps: [],
          } as unknown as EligibilityResult
        }
        onAward={vi.fn()}
        pending={false}
      />,
    );
    expect(screen.getByText(/top of the ladder/i)).toBeInTheDocument();
  });
});
