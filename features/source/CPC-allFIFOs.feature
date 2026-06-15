Feature: Form submission on Hyundai CPC

  Background:
    Given I am a user on the Hyundai Calculator page
 
  @BATD 
  Scenario: Book a test drive via CPC
    Given the user has loaded the test data from the confluence page "Automation Test Data" and find the test data "Test Drive FIFO - Test Data"
    And the user navigates to Calculator
    And user goes to a specific model calculator/kona
    And the user sets location postcode from test data
    And user clicks on Book a test drive
    And the form modal is displayed
    And the user selects variant from test data and clicks Next
    And the user clicks Next
    And the user selects title from test data
    And the user fills first name from test data
    And the user fills last name from test data
    And the user fills email address from test data
    And the user fills phone number from test data
    And the user selects purchase timeframe from test data
    And the user accepts consent checkbox 1
    And the user accepts consent checkbox 2
    And the user clicks Submit request
    Then the BATD submission is successful
    And it will return status code 200 in the API
    And a confirmation message should be displayed 

  @CAD
    Scenario: Contact a Dealer via CPC
    Given the user has loaded the test data from the confluence page "Automation Test Data" and find the test data "Contact a dealer FIFO - Test Data"
    And the user navigates to Calculator
    And user goes to a specific model calculator/kona
    And the user sets location postcode from test data
    And user clicks on Contact a dealer
    And the form modal is displayed
    When the user selects title from test data
    And the user fills first name from test data
    And the user fills last name from test data
    And the user fills email address from test data
    And the user fills phone number from test data
    And the user fills postcode from test data
    And the user selects purchase timeframe from test data
    And the user selects Model of interest from test data
    And the user selects Variant from test data
    And the user accepts consent checkbox 1
    And the user accepts consent checkbox 2
    And the user clicks Submit button
    Then the CAD submission is successful
    And it will return status code 200 in the API
    And a confirmation message should be displayed 

@BAV
 Scenario: Book a valuation test on CPC
    Given the user has loaded the test data from the confluence page "Automation Test Data" and find the test data "Book a Valuation FIFO - Test Data"
    And the user navigates to Calculator
    And user goes to a specific model calculator/kona
    And the user sets location postcode from test data
    And user clicks on Book a valuation
    And the form modal is displayed
    When the user selects Model from test data
    And clicks Next
    And the user fills Title from test data
    And the user fills first name from test data
    And the user fills last name from test data
    And the user fills email address from test data
    And the user fills phone number from test data
    And the user fills What car model are you currently driving from test data
    And clicks Next
    Then Your Location Screen is displayed
    And user clicks Next
    And the user accepts consent checkbox 1
    And the user accepts consent checkbox 2
    And the user accepts consent checkbox 3
    And the user clicks Confirm booking
    Then the BAV submission is successful
    And it will return status code 200 in the API
    And a confirmation message should be displayed 

