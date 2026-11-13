import { mount } from 'svelte';
import './app.css';
import Spike from './spike/Spike.svelte';

const target = document.getElementById('app');
if (!target) {
  throw new Error('Missing #app element');
}

const start = performance.now();
mount(Spike, { target });
(window as unknown as { __mountMs: number }).__mountMs = performance.now() - start;
