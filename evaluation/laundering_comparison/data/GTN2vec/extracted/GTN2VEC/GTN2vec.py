# -*- coding:utf-8 -*-

#from args import args_parser
from matplotlib import pyplot as plt
from sklearn import linear_model
from sklearn.ensemble import RandomForestClassifier

from sklearn.model_selection import cross_val_score
from GTN2vec_walk import GTN2vec
import networkx as nx

from sklearn.metrics import classification_report
from sklearn.model_selection import train_test_split, GridSearchCV


from utils import *
from sklearn.metrics import confusion_matrix
import argparse
import pandas as pd






def args_parser():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", default=2022, type=int, help="random seed") 
    parser.add_argument('--p', type=float, default=1, help='return parameter')
    parser.add_argument('--q', type=float, default=0.8, help='exploration parameter')
    parser.add_argument('--d', type=int, default=128, help='dimension')
    parser.add_argument('--r', type=int, default=80, help='walks per node')
    parser.add_argument('--l', type=int, default=80, help='walk length')
    parser.add_argument('--k', type=float, default=10, help='window size')
    parser.add_argument("--train_size", default=0.8, type=float)

    args = parser.parse_args()

    return args

def main():
    args = args_parser()

    alpha = 0.7

    file_name = 'edge.txt'
    file_name1 = 'gasprice.txt'
    file_name2 = 'timestamp.txt'

    graph_format = 'edgelist'
    if graph_format == 'edgelist':
        G1 = nx.read_edgelist(file_name1, create_using=nx.MultiDiGraph(), nodetype=None, data=[('weight', float)])
        G2 = nx.read_edgelist(file_name2, create_using=nx.MultiDiGraph(), nodetype=None, data=[('weight', float)])
        G3 = nx.DiGraph()
        G4 = nx.DiGraph()
        G= nx.read_edgelist(file_name, create_using=nx.DiGraph(), nodetype=None)
        print(G1)
        print(G2)
        print(G3)

        for n,nbrs in G1.adjacency():
            for nbr,edict in nbrs.items():
                sum_gasprice = sum([d['weight'] for d in edict.values()])
                # print(n,nbr,sum_gasprice)
                G3.add_edge(n,nbr,weight=sum_gasprice)

        for n,nbrs in G2.adjacency():
            for nbr,edict in nbrs.items():
                sum_timestamp = sum([d['weight'] for d in edict.values()])
                # print(n,nbr,sum_timestamp)
                G4.add_edge(n,nbr,weight=sum_timestamp)

        for edge in G.edges():
            u, v = edge[0], edge[1]
            nbs = sorted(G.neighbors(u)) 
            gasprobs = [G3[u][n]['weight'] for n in nbs]
            # Normalized
            norm1 = sum(gasprobs)

            timeprobs = [G4[u][n]['weight'] for n in nbs]
            # Normalized
            norm2 = sum(timeprobs)

            if norm1 != 0:
                gasP = G3[u][v]['weight'] / norm1
            else:
                gasP = G3[u][v]['weight'] / 1

            if norm2 != 0:
                valueP = G4[u][v]['weight'] / norm2
            else:
                valueP = G4[u][v]['weight'] / 1

            G[u][v]['weight'] = np.power(gasP, alpha) * np.power(valueP, 1 - alpha)





    vec = GTN2vec(args, G)
    embeddings = vec.learning_features()
    print(embeddings)

    print('successfully embeddings')
    print('start classification')
    node_classification(args, embeddings)

if __name__ == '__main__':
    main()