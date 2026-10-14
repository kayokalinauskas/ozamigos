// O limitador da saída de voz: fica entre o volume mestre e a caixa de som (ver voz.ts).

/**
 * A curva do limitador para um sinal de -2 a 2 (o dobro do máximo): igual até 0,8 (-2 dB) e, acima disso,
 * arredondada até no máximo 1 (0 dB) em vez de estourar. Índice i da curva = sinal (i / 4096) * 4 - 2.
 */
export function curvaDoLimitador(): Float32Array<ArrayBuffer> {
  const curva = new Float32Array(4097);
  for (let i = 0; i < curva.length; i++) {
    const x = ((i / (curva.length - 1)) * 2 - 1) * 2;
    const a = Math.abs(x);
    curva[i] = Math.sign(x) * (a <= 0.8 ? a : 0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2));
  }
  return curva;
}

/**
 * Limitador suave, sem atraso, já ligado na caixa de som: abaixo de -2 dB o som passa igual; acima, o pico é
 * arredondado até 0 dB em vez de estourar (o estalo de saturação). Aguenta até o dobro do máximo (+6 dB).
 */
export function criarLimitador(ctx: AudioContext): AudioNode {
  const entrada = ctx.createGain();
  entrada.gain.value = 0.5; // a curva cobre de -2 a 2
  const formador = ctx.createWaveShaper();
  formador.curve = curvaDoLimitador();
  entrada.connect(formador).connect(ctx.destination);
  return entrada;
}
