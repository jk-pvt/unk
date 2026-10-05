// AquaSDR payload pod: parametric OpenSCAD source.
// Dimensions come from params.json via check_fit.py -> params.scad (never edit that file by hand).
//   python3 check_fit.py                                 # validate fit, regenerate params.scad
//   openscad -D 'part="tube"'  -o tube.stl  pod.scad
//   openscad -D 'part="cap_a"' -o cap_a.stl pod.scad     (also cap_b, deck; part="all" for an assembled preview)
// NOT validated in a CAD kernel in the session that wrote it (no OpenSCAD was available): render it, inspect it,
// and run check_fit.py before printing. Not pressure rated; the O-ring groove is provision only.
include <params.scad>;
part = "all";
$fn = 120;

R_out = tube_od / 2;
R_in = R_out - tube_wall;
clear_len = tube_len - 2 * spig_depth;      // axial length between the two spigots (deck and rails live here)
scr_z = spig_depth * 0.7;                   // screw height measured from each tube end
angles = [for (i = [0 : n_screws - 1]) 45 + i * 360 / n_screws];

module tube() {
  difference() {
    union() {
      difference() {
        cylinder(h = tube_len, r = R_out);
        translate([0, 0, -1]) cylinder(h = tube_len + 2, r = R_in);
      }
      // deck rails: the deck rests on their tops (y = -deck_t), left and right
      for (m = [0, 1]) mirror([m, 0, 0])
        translate([R_in - rail_d, -deck_t - rail_h, spig_depth]) cube([rail_d + 1, rail_h, clear_len]);
    }
    // radial M3 screws into the cap spigots, both ends
    for (a = angles, z = [scr_z, tube_len - scr_z])
      rotate([0, 0, a]) translate([0, 0, z]) rotate([0, 90, 0]) cylinder(d = screw_clear, h = R_out + 1, $fn = 32);
  }
}

module cap(which) {
  difference() {
    union() {
      cylinder(r = R_out, h = cap_flange);
      translate([0, 0, cap_flange]) difference() {
        cylinder(r = R_in - fit, h = spig_depth);
        translate([0, 0, -0.01]) cylinder(r = R_in - fit - spig_wall, h = spig_depth + 0.02);
      }
    }
    // O-ring groove on the spigot, close to the flange (clear of the screw pilots)
    translate([0, 0, cap_flange + 0.6]) rotate_extrude()
      translate([R_in - fit - 2.4, 0]) square([2.5, oring + 0.2]);
    // screw pilots through the spigot wall (self-tapping M3)
    for (a = angles) rotate([0, 0, a])
      translate([R_in - fit - spig_wall - 1, 0, cap_flange + scr_z]) rotate([0, 90, 0]) cylinder(d = screw_pilot, h = spig_wall + 2, $fn = 24);
    if (which == "a") {
      translate([usb_off[0] - usb_slot[0] / 2, usb_off[1] - usb_slot[1] / 2, -1]) cube([usb_slot[0], usb_slot[1], cap_flange + 2]);
      translate([bnc_off[0], bnc_off[1], -1]) cylinder(d = bnc_d, h = cap_flange + 2, $fn = 48);
      translate([sw_off[0], sw_off[1], -1]) cylinder(d = sw_d, h = cap_flange + 2, $fn = 48);
    } else {
      translate([pot_off[0], pot_off[1], -1]) cylinder(d = pot_d, h = cap_flange + 2, $fn = 48);
      for (p = post_offs) translate([p[0], p[1], -1]) cylinder(d = post_d, h = cap_flange + 2, $fn = 32);
      translate([gland_off[0], gland_off[1], -1]) cylinder(d = gland_d, h = cap_flange + 2, $fn = 48);
    }
  }
}

// Board pads + zip-tie slots. z0 = start of the board along the deck, w/l = board footprint.
module cradle(z0, w, l, so) {
  for (sx = [-1, 1], sz = [0, 1])
    translate([sx * (w / 2 - 5), 0, z0 + 4 + sz * (l - 8)]) cylinder(d = 7, h = so, $fn = 24);
}
module zip_slots(z0, w, l) {
  for (sx = [-1, 1], zz = [0.3, 0.7])
    translate([sx * (w / 2 + 4) - zip_w / 2, -deck_t - 1, z0 + zz * l - zip_t / 2]) cube([zip_w, deck_t + 2, zip_t]);
}

module deck() {
  nz = end_margin;                       // Nucleo start
  az = end_margin + nuc_l + board_gap;   // analog front end start
  bz = (deck_len - bat_l) / 2;           // battery (underneath), centred
  difference() {
    union() {
      translate([-deck_w / 2, -deck_t, 0]) cube([deck_w, deck_t, deck_len]);
      translate([0, 0, 0]) cradle(nz, nuc_w, nuc_l, nuc_so);
      translate([0, 0, 0]) cradle(az, afe_w, afe_l, afe_so);
    }
    zip_slots(nz, nuc_w, nuc_l);
    zip_slots(az, afe_w, afe_l);
    // battery straps: slots either side of the pack, two stations
    for (sx = [-1, 1], zz = [0.25, 0.75])
      translate([sx * (bat_w / 2 + 4) - zip_w / 2, -deck_t - 1, bz + zz * bat_l - zip_t / 2]) cube([zip_w, deck_t + 2, zip_t]);
    // wiring pass-through between the boards, down to the battery bay
    translate([-15, -deck_t - 1, nz + nuc_l + board_gap / 2 - 3]) cube([30, deck_t + 2, 6]);
  }
}

if (part == "tube") tube();
else if (part == "cap_a") cap("a");
else if (part == "cap_b") cap("b");
else if (part == "deck") deck();
else {
  // assembled preview, axis along +Z
  color("lightgray", 0.35) tube();
  color("steelblue") translate([0, 0, spig_depth + (clear_len - deck_len) / 2]) deck();
  // flange outside the tube end, spigot inside it
  color("darkseagreen") translate([0, 0, -cap_flange]) cap("a");
  color("darkseagreen") translate([0, 0, tube_len + cap_flange]) mirror([0, 0, 1]) cap("b");
}
