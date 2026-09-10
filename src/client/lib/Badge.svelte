<script lang="ts">
  import { METRIC_LABELS, type MetricType } from "./api.js";
  let { type }: { type: MetricType } = $props();
</script>

<span class="badge {type}">{METRIC_LABELS[type]}</span>

<style>
  /* Functional taxonomy, not decoration — and always carrying its text label,
     so colour is never the only signal. */
  .badge {
    font-family: var(--f-display);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    height: 26px;
    padding: 0 10px;
    border-radius: 7px;
    color: #fff;
    flex: none;
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
  }
  .total_weight { background: var(--m-total); }
  .bodyweight { background: var(--m-body); }
  .bodyweight_plus { background: var(--m-bodyplus); }
  .dumbbell { background: var(--m-db); }
  .cardio { background: var(--m-cardio); }
  .hold { background: var(--m-hold); }
</style>
