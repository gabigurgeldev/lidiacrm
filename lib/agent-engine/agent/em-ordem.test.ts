import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { emOrdem, novaFilaDeEnvio } from './em-ordem';

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

describe('texto e opções dividem a fila do turno', () => {
  it('duas funções na MESMA fila saem na ordem pedida, mesmo a primeira sendo mais lenta', async () => {
    const fila = novaFilaDeEnvio();
    const saida: string[] = [];
    const texto = emOrdem(async (s: string) => {
      await new Promise((r) => setTimeout(r, 30));
      saida.push(s);
    }, fila);
    const opcoes = emOrdem(async (s: string) => {
      saida.push(s);
    }, fila);
    await Promise.all([texto('Perfeito, anotado!'), opcoes('enquete')]);
    expect(saida).toEqual(['Perfeito, anotado!', 'enquete']);
  });

  it('send_message, send_options e send_image usam a fila do turno', () => {
    const fonte = readFileSync(join(__dirname, 'inbound-turn.ts'), 'utf-8');
    const usos = fonte.split('}, filaDeEnvioDoTurno),').length - 1;
    expect(usos).toBe(3);
    const i = fonte.indexOf('    send_options: tool({');
    expect(fonte.slice(i, i + 300)).toMatch(/execute: emOrdem\(/);
    const j = fonte.indexOf('    send_image: tool({');
    expect(fonte.slice(j, j + 400)).toMatch(/execute: emOrdem\(/);
  });
});
