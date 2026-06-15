Feature: Manufacturer List Price matches between PIM and consumer site
  As an admin
  I want to fetch the test data for vehicle/variant and related options from the Confluence "Automation Test Data" page,
  then use this data to select the corresponding options on the Hyundai consumer calculator page and in PIM,
  so that the Manufacturer List Price (MLP) can be verified to match between PIM and the consumer site.

  Background:
    Given the user has loaded the test data from the Confluence page "Automation Test Data" and found the test data for "PIM and CPC for MLP - Test Data"

  Scenario: Manufacturer List Price matches between PIM and consumer site
    Given I log in to PIM Hyundai
    When I fetch the Vehicle from the test data
    And I select the specific variant in PIM as per the test data
    And I click "Pricing"
    Then I capture the PIM Manufacturer List Price for the selected variant and description
    When I open the Hyundai consumer calculator using the CPC URL from the test data
    And I select Site_Variant from test data
    And I select Extended Range Option pack from test data
    And I select Roof Basket Option pack from test data
    And I select Site_Powertrain from test data
    And I select Site_Transmission from test data
    Then the consumer Manufacturer List Price should match the PIM value