import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { emOrdem } from './em-ordem';

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('emOrdem', () => {
  it('entrega na ordem das chamadas mesmo quando a primeira demora mais', async () => {
    const saida: string[] = [];
    // A primeira demora mais — em paralelo, sairia DEPOIS da segunda.
    const enviar = emOrdem(async (texto: string, ms: number) => {
      await espera(ms);
      saida.push(texto);
      return texto;
    });
    await Promise.all([enviar('1 litro anotado', 30), enviar('Quer algum adicional?', 1)]);
    expect(saida).toEqual(['1 litro anotado', 'Quer algum adicional?']);
  });

  it('uma por vez: a segunda só começa quando a primeira termina', async () => {
    let emVoo = 0;
    let pico = 0;
    const f = emOrdem(async () => {
      emVoo += 1;
      pico = Math.max(pico, emVoo);
      await espera(5);
      emVoo -= 1;
    });
    await Promise.all([f(), f(), f()]);
    expect(pico).toBe(1);
  });

  it('falha de uma chamada volta a quem chamou e não trava a fila', async () => {
    const f = emOrdem(async (n: number) => {
      if (n === 1) throw new Error('canal caiu');
      return n;
    });
    const [a, b] = await Promise.allSettled([f(1), f(2)]);
    expect(a.status).toBe('rejected');
    expect(b).toEqual({ status: 'fulfilled', value: 2 });
  });
});

describe('send_message do turno passa pela fila', () => {
  // Sem isto, tirar o `emOrdem` do inbound-turn deixa os testes acima verdes e
  // o cliente volta a receber a pergunta antes da confirmação.
  it('o execute do send_message é envolvido por emOrdem', () => {
    const fonte = readFileSync(join(__dirname, 'inbound-turn.ts'), 'utf-8');
    const i = fonte.indexOf('    send_message: tool({');
    expect(i).toBeGreaterThan(-1);
    expect(fonte.slice(i, i + 300)).toMatch(/execute: emOrdem\(/);
  });
});
