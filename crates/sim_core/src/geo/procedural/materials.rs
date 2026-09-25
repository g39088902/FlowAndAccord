//! Stable physical material properties used by strata and voxel projection.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct MaterialProps {
    pub id: u8,
    pub hardness: f32,
    pub soil_storage: f32,
    pub permeability: f32,
    pub palette: u8,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MaterialTable {
    pub entries: Vec<MaterialProps>,
}

impl Default for MaterialTable {
    fn default() -> Self {
        Self {
            entries: vec![
                MaterialProps {
                    id: 0,
                    hardness: 0.5,
                    soil_storage: 0.7,
                    permeability: 0.5,
                    palette: 0,
                },
                MaterialProps {
                    id: 1,
                    hardness: 0.2,
                    soil_storage: 0.9,
                    permeability: 0.8,
                    palette: 1,
                },
                MaterialProps {
                    id: 2,
                    hardness: 0.1,
                    soil_storage: 0.2,
                    permeability: 0.95,
                    palette: 2,
                },
                MaterialProps {
                    id: 3,
                    hardness: 0.7,
                    soil_storage: 0.35,
                    permeability: 0.35,
                    palette: 3,
                },
                MaterialProps {
                    id: 4,
                    hardness: 0.95,
                    soil_storage: 0.05,
                    permeability: 0.05,
                    palette: 3,
                },
            ],
        }
    }
}

impl MaterialTable {
    pub fn get(&self, id: u8) -> Option<&MaterialProps> {
        self.entries.iter().find(|props| props.id == id)
    }

    pub fn validate(&self) -> bool {
        let mut ids = BTreeMap::new();
        !self.entries.is_empty()
            && self.entries.iter().all(|props| {
                props.hardness.is_finite()
                    && (0.0..=1.0).contains(&props.hardness)
                    && props.soil_storage.is_finite()
                    && (0.0..=1.0).contains(&props.soil_storage)
                    && props.permeability.is_finite()
                    && (0.0..=1.0).contains(&props.permeability)
                    && ids.insert(props.id, ()).is_none()
            })
    }
}
