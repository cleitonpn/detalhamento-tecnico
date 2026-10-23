# -*- coding: utf-8 -*-
"""Cena falsa do 3ds Max (imitação mínima do pymxs) para testar o exportador sem o programa.
Uso: python simular_cena.py saida.glb"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import detalha_exportar as ex  # noqa: E402


class P3(object):
    def __init__(self, x, y, z):
        self.x, self.y, self.z = float(x), float(y), float(z)


class Color(object):
    def __init__(self, r, g, b):
        self.r, self.g, self.b = r, g, b


class M3(object):
    """Matrix3 do Max: linhas = eixos X, Y, Z e posição (p * M)."""

    def __init__(self, r1, r2, r3, r4):
        self.row1, self.row2, self.row3, self.row4 = (P3(*r) for r in (r1, r2, r3, r4))

    def apply(self, p):
        r = (self.row1, self.row2, self.row3, self.row4)
        return P3(*[p[0] * r[0].__dict__[c] + p[1] * r[1].__dict__[c] + p[2] * r[2].__dict__[c] + r[3].__dict__[c] for c in "xyz"])


def rot_z(deg, pos):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return M3((c, s, 0), (-s, c, 0), (0, 0, 1), pos)


def inverse(m):
    a = [[m.row1.x, m.row1.y, m.row1.z], [m.row2.x, m.row2.y, m.row2.z], [m.row3.x, m.row3.y, m.row3.z]]
    det = (a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
           + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]))
    inv = [[0] * 3 for _ in range(3)]
    for i in range(3):
        for j in range(3):
            minor = [[a[r][c] for c in range(3) if c != i] for r in range(3) if r != j]
            inv[i][j] = ((-1) ** (i + j)) * (minor[0][0] * minor[1][1] - minor[0][1] * minor[1][0]) / det
    t = m.row4
    pos = [-(t.x * inv[0][k] + t.y * inv[1][k] + t.z * inv[2][k]) for k in range(3)]
    return M3(inv[0], inv[1], inv[2], pos)


class Layer(object):
    def __init__(self, name, hidden=False):
        self.name, self.isHidden = name, hidden


class Mat(object):
    def __init__(self, name, color=None, cls="StandardMaterial", subs=None):
        self.name, self.diffuse, self.cls = name, color, cls
        if subs:
            self.materialIDList = [i + 1 for i in range(len(subs))]
            self.materialList = subs


class Node(object):
    def __init__(self, name, transform=None, box=None, children=(), group=False, material=None,
                 layer="0", hidden=False, face_ids=None):
        self.name, self.transform, self.box = name, transform or M3((1, 0, 0), (0, 1, 0), (0, 0, 1), (0, 0, 0)), box
        self.children, self.group, self.material = list(children), group, material
        self.layer, self.isNodeHidden, self.face_ids = Layer(layer), hidden, face_ids
        self.wirecolor, self.parent = Color(200, 120, 40), None
        for c in self.children:
            c.parent = self


BOX_FACES = [(1, 2, 4), (1, 4, 3), (5, 7, 8), (5, 8, 6), (1, 5, 6), (1, 6, 2),
             (3, 4, 8), (3, 8, 7), (1, 3, 7), (1, 7, 5), (2, 6, 8), (2, 8, 4)]


class TriMesh(object):
    def __init__(self, node):
        w, d, h = node.box  # caixa no espaço do objeto, a partir da origem
        local = [(x, y, z) for x in (0, w) for y in (0, d) for z in (0, h)]
        self.verts = [node.transform.apply(p) for p in local]
        self.faces = BOX_FACES
        self.ids = node.face_ids or [1] * len(BOX_FACES)


class Runtime(object):
    GeometryClass, TriMeshGeometry, Multimaterial = "geometry", "trimesh", "Multimaterial"

    class units(object):
        SystemType, SystemScale = "centimeters", 1.0

    def __init__(self, roots):
        self.rootNode = Node("root", children=roots)
        self.selection, self.maxFileName = [], "stand.max"

    def superClassOf(self, n):
        return "geometry" if n.box else "helper"

    def canConvertTo(self, n, cls):
        return bool(n.box)

    def isGroupHead(self, n):
        return n.group

    def classOf(self, x):
        return getattr(x, "cls", "Box")

    def getProperty(self, mat, prop):
        if prop == "diffuse":
            return mat.diffuse
        raise AttributeError(prop)

    def getHandleByAnim(self, n):
        return id(n)

    def snapshotAsMesh(self, n):
        return TriMesh(n)

    def inverse(self, m):
        return inverse(m)

    def getNumVerts(self, m):
        return len(m.verts)

    def getVert(self, m, i):
        return m.verts[i - 1]

    def getNumFaces(self, m):
        return len(m.faces)

    def getFace(self, m, i):
        return P3(*m.faces[i - 1])

    def getFaceMatID(self, m, i):
        return m.ids[i - 1]

    def delete(self, m):
        pass


def cena():
    madeira = Mat("MDF Carvalho", Color(170, 120, 70))
    branco = Mat("Laca branca", Color(250, 250, 250))
    # Balcão: grupo com tampo (200 × 60 × 3 cm) girado 30° e lateral; peça inteira girada
    tampo = Node("Tampo", rot_z(30, (100, 50, 97)), (200, 60, 3), material=madeira)
    lateral = Node("Lateral", rot_z(30, (100, 50, 0)), (3, 60, 97), material=branco)
    balcao = Node("Balcão recepção", rot_z(30, (100, 50, 0)), children=[tampo, lateral], group=True,
                  layer="MOBILIARIO")
    # Testeira 300 × 3 × 100 cm a 340 cm do chão, frente adesivada (material 2 nas faces +y)
    ids = [1] * 12
    ids[6], ids[7] = 2, 2
    multi = Mat("Testeira", cls="Multimaterial", subs=[branco, Mat("Adesivo MOOVE", Color(220, 40, 160))])
    testeira = Node("Testeira frontal", M3((1, 0, 0), (0, 1, 0), (0, 0, 1), (0, 0, 340)), (300, 3, 100),
                    material=multi, layer="TESTEIRA", face_ids=ids)
    oculto = Node("Rascunho", box=(10, 10, 10), hidden=True)
    return [balcao, testeira, oculto]


if __name__ == "__main__":
    rt = Runtime(cena())
    parts, objects = ex.export_scene(rt, sys.argv[1])
    print("%d %d" % (parts, objects))
