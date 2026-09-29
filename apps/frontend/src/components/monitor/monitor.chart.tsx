'use client';

import { FC, useEffect, useRef } from 'react';
import DrawChart from 'chart.js/auto';
import useCookie from 'react-use-cookie';

export type MonitorSeries = { label: string; color: string; data: Array<number | null> };

/**
 * Trend (line) or comparison (bar) chart of the 监控 page, on the chart.js the analytics page
 * uses; tooltips follow the light / dark mode like ChartSocial.
 */
export const MonitorChart: FC<{
  type: 'line' | 'bar';
  labels: string[];
  series: MonitorSeries[];
  ariaLabel: string;
}> = ({ type, labels, series, ariaLabel }) => {
  const [mode] = useCookie('mode', 'dark');
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!ref.current) {
      return;
    }
    const grid = mode === 'dark' ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)';
    const tick = mode === 'dark' ? '#9c9c9c' : '#777';
    const chart = new DrawChart(ref.current, {
      type,
      data: {
        labels,
        datasets: series.map((s) => ({
          label: s.label,
          data: s.data,
          borderColor: s.color,
          backgroundColor: type === 'bar' ? s.color : s.color.replace('rgb(', 'rgba(').replace(')', ', 0.12)'),
          borderWidth: 2,
          borderRadius: type === 'bar' ? 4 : 0,
          tension: 0.35,
          pointRadius: labels.length > 40 ? 0 : 2,
          pointHoverRadius: 5,
          spanGaps: true,
        })),
      },
      options: {
        maintainAspectRatio: false,
        responsive: true,
        animation: { duration: 400 },
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { grid: { display: false }, ticks: { color: tick, maxTicksLimit: 8, font: { size: 11 } } },
          y: { beginAtZero: true, grid: { color: grid }, ticks: { color: tick, maxTicksLimit: 5, font: { size: 11 } } },
        },
        plugins: {
          legend: {
            display: series.length > 1,
            position: 'bottom',
            labels: { color: tick, boxWidth: 10, boxHeight: 10, font: { size: 12 } },
          },
          tooltip: {
            backgroundColor: mode === 'dark' ? '#1e1d1d' : '#fff',
            titleColor: mode === 'dark' ? '#fff' : '#000',
            bodyColor: mode === 'dark' ? '#d0d0d0' : '#333',
            borderColor: mode === 'dark' ? '#2b2b2b' : '#e7e9eb',
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
          },
        },
      },
    });
    return () => chart.destroy();
  }, [type, labels, series, mode]);

  return <canvas ref={ref} role="img" aria-label={ariaLabel} className="w-full h-full" />;
};
