Feature: Hyundai CRM Ownership Update

  Background:
    Given the user has loaded the test data from the confluence page "Automation Test Data" and find the test data "Ownership - Test Data"

  @Ownership
  Scenario: Successful ownership verification and submission returns status code 200
    Given the user navigates to Ownership
    And user enters a valid VIN
    And the user clicks Check
    And values are returned on the following field Vehicle model, Vehicle description, Vehicle colour, Vehicle year
    And the Vehicle model, Vehicle description, Vehicle colour, Vehicle year fields are uneditable
    And the user selects option on Do you still own this vehicle?
    And the contact details section are displayed
    And the user enters Title
    And the user enters a First name
    And the user enters a Lastname
    And the user enters an email address
    And the user enters a phone number
    And the user enters an address
    And the user enters a Suburb
    And the user selects a State
    And the user enters postcode
    And the user accepts marketing authorisation
    And the user submits the ownership form
    When the user confirms ownership in the popup
    Then the ownership update should be submitted successfully
