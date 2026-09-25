//! Deterministic Surface Nets extraction for sparse voxel chunks.
use crate::geo::procedural::Field3Chunk;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MeshVertex {
    pub position: [f32; 3],
    pub material: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MeshTriangle(pub u32, pub u32, pub u32);

#[derive(Debug, Clone, Default, PartialEq)]
pub struct SurfaceMesh {
    pub vertices: Vec<MeshVertex>,
    pub triangles: Vec<MeshTriangle>,
}

pub fn extract_surface_nets(chunk: &Field3Chunk, scale: f32) -> SurfaceMesh {
    extract_surface_nets_at(chunk, scale, [0.0; 3])
}

/// Extract a deterministic Surface Nets mesh, including the chunk halo in the
/// scalar samples and placing vertices in world space at `origin`.
pub fn extract_surface_nets_at(chunk: &Field3Chunk, scale: f32, origin: [f32; 3]) -> SurfaceMesh {
    let size = chunk.size as usize;
    if size == 0 || chunk.halo == 0 || !scale.is_finite() || scale <= 0.0 {
        return SurfaceMesh::default();
    }
    let side = size + 2 * chunk.halo as usize;
    let halo = chunk.halo as usize;
    let node_index = |x: usize, y: usize, z: usize| z * side * side + y * side + x;
    let cell_index = |x: usize, y: usize, z: usize| z * size * size + y * size + x;
    let corners = [
        (0usize, 0usize, 0usize),
        (1, 0, 0),
        (1, 1, 0),
        (0, 1, 0),
        (0, 0, 1),
        (1, 0, 1),
        (1, 1, 1),
        (0, 1, 1),
    ];
    let edges = [
        (0usize, 1usize),
        (1, 2),
        (2, 3),
        (3, 0),
        (4, 5),
        (5, 6),
        (6, 7),
        (7, 4),
        (0, 4),
        (1, 5),
        (2, 6),
        (3, 7),
    ];
    let mut mesh = SurfaceMesh::default();
    let mut cell_vertices = vec![None; size * size * size];

    for z in 0..size {
        for y in 0..size {
            for x in 0..size {
                let mut density = [0i16; 8];
                let mut materials = [0u8; 8];
                for (i, &(dx, dy, dz)) in corners.iter().enumerate() {
                    let index = node_index(x + halo + dx, y + halo + dy, z + halo + dz);
                    density[i] = chunk.density_q16[index];
                    materials[i] = chunk.material[index];
                }
                let positive = density.iter().filter(|&&d| d >= 0).count();
                if positive == 0 || positive == 8 {
                    continue;
                }
                let mut position = [0.0f32; 3];
                let mut intersections = 0u32;
                for &(a, b) in &edges {
                    if (density[a] >= 0) == (density[b] >= 0) {
                        continue;
                    }
                    let da = density[a] as f32;
                    let db = density[b] as f32;
                    let t = (da / (da - db)).clamp(0.0, 1.0);
                    let (ax, ay, az) = corners[a];
                    let (bx, by, bz) = corners[b];
                    position[0] += x as f32 + ax as f32 + t * (bx as f32 - ax as f32);
                    position[1] += y as f32 + ay as f32 + t * (by as f32 - ay as f32);
                    position[2] += z as f32 + az as f32 + t * (bz as f32 - az as f32);
                    intersections += 1;
                }
                if intersections == 0 {
                    continue;
                }
                let divisor = intersections as f32;
                let material = materials
                    .iter()
                    .zip(density.iter())
                    .find(|(_, &d)| d >= 0)
                    .map(|(&m, _)| m)
                    .unwrap_or(materials[0]);
                let index = mesh.vertices.len() as u32;
                mesh.vertices.push(MeshVertex {
                    position: [
                        origin[0] + position[0] * scale / divisor,
                        origin[1] + position[1] * scale / divisor,
                        origin[2] + position[2] * scale / divisor,
                    ],
                    material,
                });
                cell_vertices[cell_index(x, y, z)] = Some(index);
            }
        }
    }

    for z in 0..=size {
        for y in 0..=size {
            for x in 0..size {
                let a = chunk.density_q16[node_index(x + halo, y + halo, z + halo)];
                let b = chunk.density_q16[node_index(x + 1 + halo, y + halo, z + halo)];
                if edge_crosses(a, b) {
                    add_quad(
                        &mut mesh,
                        &cell_vertices,
                        size,
                        [
                            (x, y.wrapping_sub(1), z.wrapping_sub(1)),
                            (x, y, z.wrapping_sub(1)),
                            (x, y, z),
                            (x, y.wrapping_sub(1), z),
                        ],
                    );
                }
            }
        }
    }
    for z in 0..=size {
        for y in 0..size {
            for x in 0..=size {
                let a = chunk.density_q16[node_index(x + halo, y + halo, z + halo)];
                let b = chunk.density_q16[node_index(x + halo, y + 1 + halo, z + halo)];
                if edge_crosses(a, b) {
                    add_quad(
                        &mut mesh,
                        &cell_vertices,
                        size,
                        [
                            (x.wrapping_sub(1), y, z.wrapping_sub(1)),
                            (x.wrapping_sub(1), y, z),
                            (x, y, z),
                            (x, y, z.wrapping_sub(1)),
                        ],
                    );
                }
            }
        }
    }
    for z in 0..size {
        for y in 0..=size {
            for x in 0..=size {
                let a = chunk.density_q16[node_index(x + halo, y + halo, z + halo)];
                let b = chunk.density_q16[node_index(x + halo, y + halo, z + 1 + halo)];
                if edge_crosses(a, b) {
                    add_quad(
                        &mut mesh,
                        &cell_vertices,
                        size,
                        [
                            (x.wrapping_sub(1), y.wrapping_sub(1), z),
                            (x, y.wrapping_sub(1), z),
                            (x, y, z),
                            (x.wrapping_sub(1), y, z),
                        ],
                    );
                }
            }
        }
    }
    mesh
}

#[inline]
fn edge_crosses(a: i16, b: i16) -> bool {
    (a >= 0) != (b >= 0)
}

fn add_quad(
    mesh: &mut SurfaceMesh,
    cell_vertices: &[Option<u32>],
    size: usize,
    cells: [(usize, usize, usize); 4],
) {
    let mut vertices = [0u32; 4];
    for (out, (x, y, z)) in vertices.iter_mut().zip(cells) {
        if x >= size || y >= size || z >= size {
            return;
        }
        let index = z * size * size + y * size + x;
        let Some(value) = cell_vertices[index] else {
            return;
        };
        *out = value;
    }
    if vertices[0] == vertices[1]
        || vertices[1] == vertices[2]
        || vertices[2] == vertices[3]
        || vertices[3] == vertices[0]
    {
        return;
    }
    mesh.triangles
        .push(MeshTriangle(vertices[0], vertices[1], vertices[2]));
    mesh.triangles
        .push(MeshTriangle(vertices[0], vertices[2], vertices[3]));
}
