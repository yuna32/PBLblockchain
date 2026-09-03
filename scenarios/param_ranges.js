export const PARAM_RANGES = {
  PonziScheme: {
    participant_count:        { min: 5,    max: 30   },
    deposit_eth_min:          { min: 0.1,  max: 1.0  },
    deposit_eth_max:          { min: 1.0,  max: 5.0  },
    reward_rate:              { min: 0.05, max: 0.30 },
    owner_withdraw_at_ratio:  { min: 0.50, max: 0.90 },
    early_exit_ratio:         { min: 0.10, max: 0.40 }
  },
  RugPull: {
    participant_count:        { min: 3,    max: 20   },
    deposit_eth_min:          { min: 0.5,  max: 2.0  },
    deposit_eth_max:          { min: 2.0,  max: 10.0 },
    dump_delay_blocks:        { min: 1,    max: 5    }
  },
  MoneyLaundering: {
    depositor_count:          { min: 10,   max: 50   },
    deposit_eth_min:          { min: 0.05, max: 0.2  },
    deposit_eth_max:          { min: 0.2,  max: 0.5  },
    collector_count:          { min: 1,    max: 3    },
    collect_after_ratio:      { min: 0.70, max: 0.95 }
  },
  PumpDump: {
    insider_count:            { min: 2,    max: 5    },
    latecomer_count:          { min: 5,    max: 20   },
    insider_deposit_ratio:    { min: 0.40, max: 0.70 },
    dump_delay_blocks:        { min: 2,    max: 10   }
  },
  Normal: {
    participant_count:        { min: 5,    max: 25   },
    stake_eth_min:            { min: 0.1,  max: 0.5  },
    stake_eth_max:            { min: 0.5,  max: 3.0  },
    stake_duration_blocks:    { min: 10,   max: 50   }
  }
};

export function sampleUniform(range) {
  return Math.random() * (range.max - range.min) + range.min;
}

export function sampleInt(range) {
  return Math.floor(sampleUniform(range));
}
