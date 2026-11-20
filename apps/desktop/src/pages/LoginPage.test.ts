import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createElement } from 'react';

const sendCode = vi.fn(async () => ({ is_new_user: false, expires_in_minutes: 10 }));
const verifyCode = vi.fn(async () => ({}));
vi.mock('@/services/infra/auth', () => ({ authService: { sendCode: (...a: unknown[]) => sendCode(...(a as [])), verifyCode: (...a: unknown[]) => verifyCode(...(a as [])) } }));
vi.mock('@/components/layout/TitleBar', () => ({ default: () => null }));
vi.mock('@/services/infra/externalLinks', () => ({ openExternalUrl: vi.fn() }));

import LoginPage from './LoginPage';

async function toOtpStep() {
  render(createElement(MemoryRouter, null, createElement(LoginPage)));
  fireEvent.change(screen.getByPlaceholderText('ton@email.com'), { target: { value: 'a@b.com' } });
  fireEvent.submit(screen.getByPlaceholderText('ton@email.com').closest('form')!);
  await waitFor(() => expect(sendCode).toHaveBeenCalled());
  return waitFor(() => {
    const inputs = document.querySelectorAll<HTMLInputElement>('input[inputmode="numeric"]');
    expect(inputs.length).toBe(6);
    return inputs;
  });
}

describe('connexion par code', () => {
  beforeEach(() => { sendCode.mockClear(); verifyCode.mockClear(); });

  it('vérifie automatiquement le code complet après le 6e chiffre, sans erreur', async () => {
    const inputs = await toOtpStep();
    '329999'.split('').forEach((d, i) => fireEvent.change(inputs[i], { target: { value: d } }));
    await waitFor(() => expect(verifyCode).toHaveBeenCalledWith('a@b.com', '329999'));
    expect(screen.queryByText(/code complet/)).toBeNull();
  });

  it('vérifie le code collé en une fois', async () => {
    const inputs = await toOtpStep();
    fireEvent.paste(inputs[0], { clipboardData: { getData: () => '123456' } });
    await waitFor(() => expect(verifyCode).toHaveBeenCalledWith('a@b.com', '123456'));
  });

  it("ne propose plus la connexion par mot de passe", async () => {
    render(createElement(MemoryRouter, null, createElement(LoginPage)));
    expect(screen.queryByText(/avec un mot de passe/)).toBeNull();
  });
});
