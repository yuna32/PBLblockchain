import random
import numpy as np
from numba import njit, jit


@njit
def numba_seed(sd):
    np.random.seed(sd)


def random_seed(seed=None):
    np.random.seed(seed)
    numba_seed(seed)
    random.seed(seed)


def load_labels(filename):
    fin = open(filename, 'r')
    labels = {}
    while 1:
        l = fin.readline()
        if l == '':
            break
        #vec = l.strip().split(' ')
        vec = l.strip().split(',')
        node = str(int(vec[0]) - 1)
        labels[node] = int(vec[1])
    fin.close()
    return labels