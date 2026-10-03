CREATE TABLE app_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE circles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subdivision_id INTEGER NOT NULL,
    circle_code TEXT,
    circle_name TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(subdivision_id) REFERENCES subdivisions(id),
    UNIQUE(subdivision_id, circle_code)
);

CREATE TABLE districts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    state_id INTEGER NOT NULL,
    district_code TEXT,
    district_name TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(state_id) REFERENCES states(id),
    UNIQUE(state_id, district_code)
);

CREATE TABLE families (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    family_name TEXT NOT NULL UNIQUE,
    description TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE family_access_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    family_id INTEGER NOT NULL,
    access_code_hash TEXT NOT NULL,
    access_type TEXT NOT NULL DEFAULT 'VIEW' CHECK (access_type IN ('VIEW')),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE
);

CREATE TABLE family_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    family_id INTEGER NOT NULL,
    member_name TEXT NOT NULL,
    display_name TEXT,
    relation TEXT,
    notes TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE,
    UNIQUE (family_id, member_name)
);

CREATE TABLE locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    location_name TEXT NOT NULL,
    mauza TEXT,
    notes TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, village_id INTEGER, location_type TEXT DEFAULT 'LOCAL_AREA', geometry_type TEXT, geometry_geojson TEXT, bbox_xmin REAL, bbox_ymin REAL, bbox_xmax REAL, bbox_ymax REAL, center_lat REAL, center_lng REAL, boundary_source TEXT,
    UNIQUE (location_name, mauza)
);

CREATE TABLE plot_coowners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plot_id INTEGER NOT NULL,
    family_member_id INTEGER NOT NULL,
    ownership_note TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (plot_id) REFERENCES plots(id) ON DELETE CASCADE,
    FOREIGN KEY (family_member_id) REFERENCES family_members(id),
    UNIQUE (plot_id, family_member_id)
);

CREATE TABLE plot_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plot_id INTEGER NOT NULL,
    location_id INTEGER NOT NULL,
    is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(plot_id) REFERENCES plots(id) ON DELETE CASCADE,
    FOREIGN KEY(location_id) REFERENCES locations(id) ON DELETE CASCADE,
    UNIQUE(plot_id, location_id)
);

CREATE TABLE plot_survey_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_plot_id INTEGER NOT NULL,
    target_plot_id INTEGER NOT NULL,
    relation_type TEXT,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(source_plot_id) REFERENCES plots(id),
    FOREIGN KEY(target_plot_id) REFERENCES plots(id),
    UNIQUE(source_plot_id, target_plot_id)
);

CREATE TABLE plots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  survey TEXT NOT NULL,
  sheet TEXT NOT NULL,
  gis_code TEXT NOT NULL,
  levels TEXT NOT NULL,
  plot_no TEXT NOT NULL,
  plot_id TEXT,
  pniu TEXT,
  seed_x REAL,
  seed_y REAL,
  xmin REAL,
  ymin REAL,
  xmax REAL,
  ymax REAL,
  owner TEXT DEFAULT '',
  local_name TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  center_lat REAL,
  center_lng REAL,
  google_map_url TEXT DEFAULT '',
  geometry_geojson TEXT,
  source TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP, map_instance TEXT, mauza TEXT, thana_no TEXT, jamabandi_no TEXT, part_no TEXT, page_no TEXT, computerized_jamabandi_no TEXT, khata_no TEXT, khesra_no TEXT, plot_area_decimal REAL, jamabandi_total_area_decimal REAL, exact_raiyat_name TEXT, ownership_type TEXT, family_id INTEGER, primary_family_member_id INTEGER, location_id INTEGER, village_id INTEGER, survey_map_id INTEGER, sheet_id INTEGER, geometry_type TEXT, geometry_source TEXT, geometry_updated_at TEXT, calculated_area_sqm REAL, calculated_area_decimal REAL, perimeter_m REAL, approx_length_m REAL, approx_width_m REAL, bbox_width_m REAL, bbox_height_m REAL, bbox_area_sqm REAL, measurement_source TEXT, measurement_updated_at TEXT,
  UNIQUE(survey, sheet, plot_no)
);

CREATE TABLE sheets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    survey_map_id INTEGER NOT NULL,
    sheet_code TEXT NOT NULL,
    sheet_name TEXT,
    gis_code TEXT,
    levels TEXT,
    native_xmin REAL,
    native_ymin REAL,
    native_xmax REAL,
    native_ymax REAL,
    wms_xmin REAL,
    wms_ymin REAL,
    wms_xmax REAL,
    wms_ymax REAL,
    wms_width INTEGER,
    wms_height INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(survey_map_id) REFERENCES survey_maps(id),
    UNIQUE(survey_map_id, sheet_code)
);

CREATE TABLE sqlite_sequence(name,seq);

CREATE TABLE states (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    state_code TEXT,
    state_name TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(state_code)
);

CREATE TABLE subdivisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    district_id INTEGER NOT NULL,
    subdivision_code TEXT,
    subdivision_name TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(district_id) REFERENCES districts(id),
    UNIQUE(district_id, subdivision_code)
);

CREATE TABLE survey_maps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    village_id INTEGER NOT NULL,
    survey_type TEXT NOT NULL,
    map_instance_code TEXT,
    map_instance_name TEXT,
    bhunaksha_gis_prefix TEXT,
    epsg_code TEXT DEFAULT 'EPSG:32645',
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(village_id) REFERENCES villages(id),
    UNIQUE(village_id, survey_type, map_instance_code)
);

CREATE TABLE user_family_access (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    family_id INTEGER NOT NULL,
    can_view INTEGER NOT NULL DEFAULT 1 CHECK (can_view IN (0,1)),
    can_add INTEGER NOT NULL DEFAULT 0 CHECK (can_add IN (0,1)),
    can_edit INTEGER NOT NULL DEFAULT 0 CHECK (can_edit IN (0,1)),
    can_delete INTEGER NOT NULL DEFAULT 0 CHECK (can_delete IN (0,1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE,
    UNIQUE (user_id, family_id)
);

CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('ADMIN','FAMILY_EDITOR','FAMILY_VIEWER')),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at TEXT
);

CREATE TABLE villages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    circle_id INTEGER NOT NULL,
    village_code TEXT,
    village_name TEXT NOT NULL,
    thana_no TEXT,
    center_lat REAL,
    center_lng REAL,
    notes TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(circle_id) REFERENCES circles(id),
    UNIQUE(circle_id, village_code)
);