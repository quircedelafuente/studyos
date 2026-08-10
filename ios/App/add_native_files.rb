#!/usr/bin/env ruby
# Añade los ficheros de App/Native al target App y sube el deployment target.
# Se ejecuta tantas veces como haga falta: es idempotente.
require 'xcodeproj'

proj_path = File.join(__dir__, 'App.xcodeproj')
project = Xcodeproj::Project.open(proj_path)
target = project.targets.find { |t| t.name == 'App' } or abort 'target App no encontrado'

# iOS 17: hace falta para @Observable, TabView moderno y SwiftData si se usa.
project.build_configurations.each { |c| c.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '17.0' }
target.build_configurations.each  { |c| c.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '17.0' }

app_group = project.main_group.find_subpath('App', true)
native_group = app_group.find_subpath('Native', true)
native_group.set_source_tree('<group>')

root = File.join(__dir__, 'App', 'Native')
existing = target.source_build_phase.files_references.map(&:real_path).map(&:to_s)
added = 0

Dir.glob(File.join(root, '**', '*.swift')).sort.each do |file|
  next if existing.include?(file)
  rel = file.sub(root + '/', '')
  group = native_group
  rel.split('/')[0...-1].each { |seg| group = group.find_subpath(seg, true); group.set_source_tree('<group>') }
  ref = group.new_reference(file)
  target.add_file_references([ref])
  added += 1
end

project.save
puts "añadidos #{added} ficheros · deployment target 17.0"
